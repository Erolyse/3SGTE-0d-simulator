import { DYNO_MODES } from "../Dyno/Dyno.js";
import DynoSweepRecorder from "../Charts/DynoSweepRecorder.js";
import { ENGINE_OPERATING_STATES } from "../EngineControl/EngineControl.js";
import {
    MAX_DYNO_RPM, PASCAL_TO_BAR, REFERENCE_PROTOCOL, MULTI_POINT_PROTOCOL
} from "./config.js";
import {
    finite, clamp, setText, formatNumber, summarizeValidationStatuses, classifyUpperStatus
} from "./utils.js";
import {
    CYCLE_VALIDATION_STATUS, evaluatePvTorqueClosure
} from "./cycle-validation.js";
import { createAnalysisEngine } from "./engine-factory.js";
import { ReferenceRunCancelledError } from "./errors.js";

export function createReferenceCampaignModule({ cycleValidator, referenceRun, ui }: any) {
    function setReferenceRunUi({
                                   phase = referenceRun.phase,
                                   progressPercent = referenceRun.progressPercent,
                                   message = null
                               }: { phase?: string; progressPercent?: number; message?: string | null } = {}) {
        referenceRun.phase = phase;
        referenceRun.progressPercent = clamp(progressPercent, 0, 100);

        setText(ui.referenceRunPhase, phase);
        if (ui.referenceRunProgress) {
            ui.referenceRunProgress.value = referenceRun.progressPercent;
            ui.referenceRunProgress.setAttribute(
                "aria-valuenow",
                String(Math.round(referenceRun.progressPercent))
            );
        }
        if (message) {
            setText(ui.dynoCaptureStatus, message);
        }
    }

    function referenceRunCheckpoint() {
        if (referenceRun.cancelRequested) {
            throw new ReferenceRunCancelledError();
        }
    }

    function yieldToBrowser() {
        return new Promise(resolve => setTimeout(resolve, 0));
    }

    async function simulateDeterministically(engine: any, {
        maximumSeconds,
        beforeStep = null,
        afterStep = null,
        stopWhen = null,
        onProgress = null,
        progressStart = 0,
        progressEnd = 100
    }: any) {
        const stepSeconds = REFERENCE_PROTOCOL.physicsCallStepSeconds;
        let elapsedSeconds = 0;
        let sliceStartedAt = performance.now();

        while (elapsedSeconds < maximumSeconds) {
            referenceRunCheckpoint();

            beforeStep?.({
                engine,
                state: engine.state,
                elapsedSeconds,
                stepSeconds
            });

            engine.update(stepSeconds);
            elapsedSeconds += stepSeconds;
            referenceRun.currentRpm = finite(engine.state.rpm);

            afterStep?.({
                engine,
                state: engine.state,
                elapsedSeconds,
                stepSeconds
            });

            if (stopWhen?.({
                engine,
                state: engine.state,
                elapsedSeconds
            })) {
                return elapsedSeconds;
            }

            if (performance.now() - sliceStartedAt
                >= REFERENCE_PROTOCOL.browserYieldBudgetMs) {
                const ratio = clamp(
                    elapsedSeconds / Math.max(maximumSeconds, 1e-9),
                    0,
                    1
                );
                const progress = progressStart
                    + (progressEnd - progressStart) * ratio;
                onProgress?.(progress, elapsedSeconds);
                await yieldToBrowser();
                sliceStartedAt = performance.now();
            }
        }

        return elapsedSeconds;
    }

    async function startFreshEngine(engine: any, {
        progressStart,
        progressEnd,
        phaseLabel
    }: any) {
        engine.state.throttle = 0;
        engine.state.dynoMode = DYNO_MODES.INERTIA;
        engine.state.dynoBrakeCommand = 0;
        engine.start();

        const startProgressEnd = progressStart
            + (progressEnd - progressStart) * 0.65;

        const elapsedToRunning = await simulateDeterministically(engine, {
            maximumSeconds: REFERENCE_PROTOCOL.maximumStartSeconds,
            beforeStep: ({ state }: any) => {
                state.throttle = 0;
            },
            stopWhen: ({ state }: any) =>
                state.engineOperatingState === ENGINE_OPERATING_STATES.RUNNING
                && state.rpm >= 650,
            progressStart,
            progressEnd: startProgressEnd,
            onProgress: (progress: any) => setReferenceRunUi({
                phase: phaseLabel,
                progressPercent: progress
            })
        });

        if (engine.state.engineOperatingState
            !== ENGINE_OPERATING_STATES.RUNNING) {
            throw new Error(
                `Le moteur de référence n'a pas démarré après ${elapsedToRunning.toFixed(1)} s simulées.`
            );
        }

        await simulateDeterministically(engine, {
            maximumSeconds: REFERENCE_PROTOCOL.idleStabilizationSeconds,
            beforeStep: ({ state }: any) => {
                state.throttle = 0;
            },
            progressStart: startProgressEnd,
            progressEnd,
            onProgress: (progress: any) => setReferenceRunUi({
                phase: phaseLabel,
                progressPercent: progress
            })
        });
    }

    function createReferenceSweepRecorder() {
        return new DynoSweepRecorder({
            rpmBinSize: 100,
            minimumRpm: 1000,
            maximumRpm: MAX_DYNO_RPM,
            minimumThrottle: 0.65,
            minimumAngularAcceleration: -2
        });
    }

    async function runDeterministicReferenceSweep() {
        const engine = createAnalysisEngine({
            baseAngleStepDeg: 0.5,
            cycleAngleStepDeg: 0.5,
            cycleHistory: 8,
            captureIntervalSeconds: 0,
            telemetryHistorySeconds: 45
        });
        const sweepRecorder = createReferenceSweepRecorder();
        const telemetry: any = [];
        let latestCycle: any = null;

        engine.telemetry.subscribe(sample => {
            telemetry.push(sample);
            sweepRecorder.ingest(sample);
        });
        engine.cycleRecorder.subscribe(cycle => {
            latestCycle = cycle;
        });

        setReferenceRunUi({
            phase: "Initialisation du tir",
            progressPercent: 1,
            message: "Tir de référence : démarrage depuis un état initial neuf."
        });

        await startFreshEngine(engine, {
            progressStart: 1,
            progressEnd: 9,
            phaseLabel: "Démarrage et stabilisation"
        });

        sweepRecorder.start({ clear: true });

        setReferenceRunUi({
            phase: "Tir déterministe",
            progressPercent: 9,
            message: "Rampe de papillon pilotée par le temps simulé, indépendante du navigateur."
        });

        const elapsed = await simulateDeterministically(engine, {
            maximumSeconds: REFERENCE_PROTOCOL.maximumSweepSeconds,
            beforeStep: ({ state, elapsedSeconds }: any) => {
                state.dynoMode = DYNO_MODES.INERTIA;
                state.dynoRoadLoadEnabled = false;
                state.throttle = clamp(
                    elapsedSeconds / REFERENCE_PROTOCOL.throttleRampSeconds,
                    0,
                    1
                );
            },
            stopWhen: ({ state }: any) =>
                state.rpm >= REFERENCE_PROTOCOL.sweepStopRpm
                || state.revLimiterActive,
            progressStart: 9,
            progressEnd: 35,
            onProgress: (progress: any, simulatedSeconds: any) => setReferenceRunUi({
                phase: "Tir déterministe",
                progressPercent: progress,
                message: `Tir de référence en cours · ${formatNumber(engine.state.rpm)} tr/min · ${simulatedSeconds.toFixed(1)} s simulées`
            })
        });

        sweepRecorder.stop();
        const points = sweepRecorder.getPoints();

        if (engine.state.rpm < REFERENCE_PROTOCOL.sweepStopRpm
            && !engine.state.revLimiterActive) {
            throw new Error(
                `Le tir de référence n'a pas atteint ${REFERENCE_PROTOCOL.sweepStopRpm} tr/min après ${elapsed.toFixed(1)} s simulées.`
            );
        }
        if (points.length < 10) {
            throw new Error(
                `Le tir de référence n'a produit que ${points.length} tranche(s) RPM.`
            );
        }

        return {
            engine,
            telemetry,
            dynoPoints: points,
            latestCycle,
            simulatedDurationSeconds: elapsed
        };
    }

    function coefficientOfVariationPercent(values: any) {
        const finiteValues = (values ?? []).filter(Number.isFinite);
        if (finiteValues.length < 2) return Infinity;
        const average = finiteValues.reduce((sum: any, value: any) => sum + value, 0)
            / finiteValues.length;
        if (Math.abs(average) <= 1e-12) return Infinity;
        const variance = finiteValues.reduce(
            (sum: any, value: any) => sum + (value - average) ** 2,
            0
        ) / (finiteValues.length - 1);
        return Math.sqrt(variance) / Math.abs(average) * 100;
    }

    function cycleStabilityCvPercent(cycles: any) {
        if (!Array.isArray(cycles) || cycles.length < 3) return Infinity;
        const series = [
            cycles.map(cycle =>
                cycle?.summary?.netIndicatedMeanEffectivePressurePa
            ),
            cycles.map(cycle => cycle?.summary?.peakPressurePa),
            cycles.map(cycle => cycle?.events?.ca50Deg),
            cycles.map(cycle => cycle?.summary?.meanRpm)
        ];
        return Math.max(
            ...series.map(coefficientOfVariationPercent)
        );
    }

    function cycleBoostSpanBar(cycles: any) {
        const values = (cycles ?? [])
            .map((cycle: any) => cycle?.summary?.meanBoostBarGauge)
            .filter(Number.isFinite);
        if (values.length < 2) return Infinity;
        return Math.max(...values) - Math.min(...values);
    }

    function telemetryWindowByDuration(samples: any, durationSeconds: any) {
        const finiteSamples = (samples ?? []).filter((sample: any) =>
            Number.isFinite(sample?.time)
        );
        if (finiteSamples.length < 2) return [];

        const lastTime = finiteSamples.at(-1).time;
        const minimumTime = lastTime - Math.max(durationSeconds, 0);
        return finiteSamples.filter((sample: any) => sample.time >= minimumTime);
    }

    function telemetryTimeSpanSeconds(samples: any) {
        if (!Array.isArray(samples) || samples.length < 2) return 0;
        return Math.max(
            0,
            finite(samples.at(-1)?.time) - finite(samples[0]?.time)
        );
    }

    function telemetryAbsoluteSlopePerSecond(samples: any, key: any) {
        if (!Array.isArray(samples) || samples.length < 2) return Infinity;
        const first = samples[0];
        const last = samples.at(-1);
        const duration = finite(last?.time) - finite(first?.time);
        if (duration <= 1e-9) return Infinity;
        const firstValue = first?.[key];
        const lastValue = last?.[key];
        if (!Number.isFinite(firstValue) || !Number.isFinite(lastValue)) {
            return Infinity;
        }
        return Math.abs(lastValue - firstValue) / duration;
    }

    function telemetryRelativeSpanPercent(samples: any, key: any) {
        const values = (samples ?? [])
            .map((sample: any) => sample?.[key])
            .filter(Number.isFinite);
        if (values.length < 2) return Infinity;
        const average = values.reduce((sum: any, value: any) => sum + value, 0)
            / values.length;
        if (Math.abs(average) <= 1e-9) return Infinity;
        return (Math.max(...values) - Math.min(...values))
            / Math.abs(average) * 100;
    }

    function getSlowSystemStability(samples: any) {
        const window = telemetryWindowByDuration(
            samples,
            MULTI_POINT_PROTOCOL.slowStabilityWindowSeconds
        );
        const durationSeconds = telemetryTimeSpanSeconds(window);
        return {
            samples: window,
            durationSeconds,
            complete: durationSeconds
                >= MULTI_POINT_PROTOCOL.slowStabilityWindowSeconds * 0.9,
            boostSlopeBarPerSecond: telemetryAbsoluteSlopePerSecond(
                window,
                "boost"
            ),
            turboRpmSpanPercent: telemetryRelativeSpanPercent(
                window,
                "turboRPM"
            )
        };
    }

    function cloneStateSnapshot(state: any) {
        if (typeof structuredClone === "function") {
            return structuredClone(state);
        }
        return JSON.parse(JSON.stringify(state));
    }

    function restoreStateSnapshot(engine: any, snapshot: any, baseStepDeg: any) {
        const cloned = cloneStateSnapshot(snapshot);
        Object.assign(engine.state, cloned);
        engine.pendingSimulationTime = 0;
        engine.physicsSubstepSequence = 0;
        engine.setAngleResolution(baseStepDeg);
        engine.telemetry.clear?.({ resetTime: true });
        engine.cycleRecorder.clear?.();
    }

    async function runBaseValidationCampaign() {
        const engine = createAnalysisEngine({
            baseAngleStepDeg: 0.5,
            cycleAngleStepDeg: 0.5,
            cycleHistory: 20,
            captureIntervalSeconds: 0,
            telemetryHistorySeconds: 15
        });

        const stabilityWindow: any = [];
        const repeatabilityCycles: any = [];
        const telemetry: any = [];
        let stabilityReached = false;
        let validationElapsedSeconds = 0;

        engine.telemetry.subscribe(sample => {
            if (validationElapsedSeconds >= 2) {
                telemetry.push(sample);
            }
        });

        engine.cycleRecorder.subscribe(cycle => {
            if (validationElapsedSeconds < 2
                || finite(cycle?.summary?.meanRpm) < 3500) {
                return;
            }

            if (!stabilityReached) {
                stabilityWindow.push(cycle);
                while (stabilityWindow.length > 5) {
                    stabilityWindow.shift();
                }

                if (stabilityWindow.length === 5
                    && cycleStabilityCvPercent(stabilityWindow) <= 0.10) {
                    stabilityReached = true;
                }
                return;
            }

            if (repeatabilityCycles.length
                < REFERENCE_PROTOCOL.repeatabilityCycleCount) {
                repeatabilityCycles.push(cycle);
            }
        });

        await startFreshEngine(engine, {
            progressStart: 35,
            progressEnd: 40,
            phaseLabel: "Préparation du point de validation"
        });

        // Le point de validation n'est pas une accélération mesurée. Le régime est
        // initialisé à la cible puis laissé au banc régulé le temps nécessaire pour
        // stabiliser les gaz, le turbo, les parois et les régulateurs.
        engine.state.rpm = REFERENCE_PROTOCOL.validationTargetRpm;
        engine.state.dynoMode = DYNO_MODES.RPM_HOLD;
        engine.state.dynoTargetRpm = REFERENCE_PROTOCOL.validationTargetRpm;
        engine.state.dynoRoadLoadEnabled = false;

        await simulateDeterministically(engine, {
            maximumSeconds: REFERENCE_PROTOCOL.validationMaximumSeconds,
            beforeStep: ({ state, elapsedSeconds }: any) => {
                validationElapsedSeconds = elapsedSeconds;
                state.dynoMode = DYNO_MODES.RPM_HOLD;
                state.dynoTargetRpm = REFERENCE_PROTOCOL.validationTargetRpm;
                state.throttle = clamp(
                    elapsedSeconds / REFERENCE_PROTOCOL.throttleRampSeconds,
                    0,
                    REFERENCE_PROTOCOL.validationThrottle
                );
            },
            stopWhen: () =>
                repeatabilityCycles.length
                >= REFERENCE_PROTOCOL.repeatabilityCycleCount,
            progressStart: 40,
            progressEnd: 50,
            onProgress: (progress: any) => setReferenceRunUi({
                phase: stabilityReached
                    ? "Capture de répétabilité"
                    : "Stabilisation thermodynamique",
                progressPercent: progress,
                message: stabilityReached
                    ? `${repeatabilityCycles.length}/${REFERENCE_PROTOCOL.repeatabilityCycleCount} cycles stables capturés automatiquement.`
                    : `Point régulé · ${formatNumber(engine.state.rpm)} tr/min · CV fenêtre ${Number.isFinite(cycleStabilityCvPercent(stabilityWindow)) ? formatNumber(cycleStabilityCvPercent(stabilityWindow), 3) : "—"} %.`
            })
        });

        if (!stabilityReached) {
            throw new Error(
                "Le point de validation n'a pas atteint le critère de stabilité de 0,10 %."
            );
        }
        if (repeatabilityCycles.length
            < REFERENCE_PROTOCOL.repeatabilityCycleCount) {
            throw new Error(
                `Seulement ${repeatabilityCycles.length}/${REFERENCE_PROTOCOL.repeatabilityCycleCount} cycles de répétabilité ont été capturés.`
            );
        }

        return {
            repeatabilityCycles,
            telemetry,
            stableStateSnapshot: cloneStateSnapshot(engine.state),
            stabilityCvPercent: cycleStabilityCvPercent(
                repeatabilityCycles
            )
        };
    }

    async function captureConvergenceCycle({
                                               stateSnapshot,
                                               baseStepDeg,
                                               progressStart,
                                               progressEnd
                                           }: any) {
        const engine = createAnalysisEngine({
            baseAngleStepDeg: baseStepDeg,
            cycleAngleStepDeg: baseStepDeg,
            cycleHistory: 6,
            captureIntervalSeconds: 0,
            telemetryHistorySeconds: 3
        });
        restoreStateSnapshot(engine, stateSnapshot, baseStepDeg);

        const cycles: any = [];
        engine.cycleRecorder.subscribe(cycle => cycles.push(cycle));

        await simulateDeterministically(engine, {
            maximumSeconds: 1.0,
            beforeStep: ({ state }: any) => {
                state.dynoMode = DYNO_MODES.RPM_HOLD;
                state.dynoTargetRpm = REFERENCE_PROTOCOL.validationTargetRpm;
                state.throttle = REFERENCE_PROTOCOL.validationThrottle;
            },
            stopWhen: () => cycles.length >= 3,
            progressStart,
            progressEnd,
            onProgress: (progress: any) => setReferenceRunUi({
                phase: `Convergence au pas ${formatNumber(baseStepDeg, 2)}°`,
                progressPercent: progress,
                message: `${cycles.length}/3 cycle(s) acquis depuis le même état physique initial.`
            })
        });

        if (cycles.length < 3) {
            throw new Error(
                `Le calcul au pas ${baseStepDeg}° n'a pas produit trois cycles complets.`
            );
        }

        return cycles.at(-1);
    }

    async function runAutomaticValidationCampaign() {
        const base = await runBaseValidationCampaign();
        const convergenceCycles: Record<number, any> = {};
        const steps = REFERENCE_PROTOCOL.convergenceStepsDeg;
        const progressStart = 50;
        const progressEnd = 60;
        const width = (progressEnd - progressStart) / steps.length;

        for (let index = 0; index < steps.length; index++) {
            const step = steps[index];
            convergenceCycles[step] = await captureConvergenceCycle({
                stateSnapshot: base.stableStateSnapshot,
                baseStepDeg: step,
                progressStart: progressStart + width * index,
                progressEnd: progressStart + width * (index + 1)
            });
        }

        return {
            repeatabilityCycles: base.repeatabilityCycles,
            convergenceCycles,
            representativeCycle: convergenceCycles[0.5],
            stabilityCvPercent: base.stabilityCvPercent,
            telemetry: base.telemetry
        };
    }


    function maximumAbsoluteTelemetryValue(samples: any, key: any) {
        let maximum = 0;
        let found = false;

        for (const sample of samples ?? []) {
            const value = sample?.[key];
            if (!Number.isFinite(value)) continue;
            maximum = Math.max(maximum, Math.abs(value));
            found = true;
        }

        return found ? maximum : NaN;
    }

    function buildOperatingPointResult({
                                           definition,
                                           cycles = [],
                                           telemetry = [],
                                           error = null
                                       }: any) {
        if (error || cycles.length === 0) {
            return {
                id: definition.id,
                label: definition.label,
                description: definition.description,
                targetRpm: definition.targetRpm,
                throttle: definition.throttle,
                status: CYCLE_VALIDATION_STATUS.FAIL,
                capturedCycleCount: cycles.length,
                error: error?.message ?? error ?? "Aucun cycle stable capturé."
            };
        }

        const representativeCycle = cycles.at(-1);
        const validationReport = cycleValidator.validate(
            representativeCycle,
            {
                cycleHistory: cycles,
                convergenceCycles: null
            }
        );
        const metrics = validationReport.metrics;
        const meanRpm = cycles.reduce(
            (sum: any, cycle: any) => sum + finite(cycle?.summary?.meanRpm),
            0
        ) / cycles.length;
        const meanBoostBarGauge = cycles.reduce(
            (sum: any, cycle: any) => sum + finite(cycle?.summary?.meanBoostBarGauge),
            0
        ) / cycles.length;
        const rpmTrackingErrorPercent = Math.abs(definition.targetRpm) > 1e-9
            ? Math.abs(meanRpm - definition.targetRpm)
            / Math.abs(definition.targetRpm) * 100
            : NaN;
        const repeatabilityCvPercent = cycleStabilityCvPercent(cycles);
        const boostSpanBar = cycleBoostSpanBar(cycles);
        const slowSystemStability = getSlowSystemStability(telemetry);
        const boostSlopeBarPerSecond
            = slowSystemStability.boostSlopeBarPerSecond;
        const turboRpmSpanPercent
            = slowSystemStability.turboRpmSpanPercent;
        const maximumMassResidualPercent = maximumAbsoluteTelemetryValue(
            telemetry,
            "maximumMassResidualPercent"
        );
        const maximumEnergyResidualPercent = maximumAbsoluteTelemetryValue(
            telemetry,
            "maximumEnergyResidualPercent"
        );

        const rpmStatus = classifyUpperStatus(
            rpmTrackingErrorPercent,
            MULTI_POINT_PROTOCOL.rpmTrackingErrorPercentPass,
            MULTI_POINT_PROTOCOL.rpmTrackingErrorPercentWarning
        );
        const repeatabilityStatus = classifyUpperStatus(
            repeatabilityCvPercent,
            MULTI_POINT_PROTOCOL.stabilityCvPercentPass,
            MULTI_POINT_PROTOCOL.stabilityCvPercentWarning
        );
        const boostStabilityStatus = classifyUpperStatus(
            boostSpanBar,
            MULTI_POINT_PROTOCOL.boostSpanBarPass,
            MULTI_POINT_PROTOCOL.boostSpanBarWarning
        );
        const boostSlopeStatus = classifyUpperStatus(
            boostSlopeBarPerSecond,
            MULTI_POINT_PROTOCOL.boostSlopeBarPerSecondPass,
            MULTI_POINT_PROTOCOL.boostSlopeBarPerSecondWarning
        );
        const turboRpmStabilityStatus = definition.throttle >= 0.5
            ? classifyUpperStatus(
                turboRpmSpanPercent,
                MULTI_POINT_PROTOCOL.turboRpmSpanPercentPass,
                MULTI_POINT_PROTOCOL.turboRpmSpanPercentWarning
            )
            : CYCLE_VALIDATION_STATUS.PASS;
        const massResidualStatus = classifyUpperStatus(
            maximumMassResidualPercent,
            MULTI_POINT_PROTOCOL.massResidualPercentPass,
            MULTI_POINT_PROTOCOL.massResidualPercentWarning
        );
        const energyResidualStatus = classifyUpperStatus(
            maximumEnergyResidualPercent,
            MULTI_POINT_PROTOCOL.energyResidualPercentPass,
            MULTI_POINT_PROTOCOL.energyResidualPercentWarning
        );
        const pvClosureAssessment = evaluatePvTorqueClosure(
            metrics?.torqueFromPvNm,
            metrics?.meanIndicatedTorqueNm
        );
        const statusSummary = summarizeValidationStatuses([
            validationReport.status,
            pvClosureAssessment.status,
            rpmStatus,
            repeatabilityStatus,
            boostStabilityStatus,
            boostSlopeStatus,
            turboRpmStabilityStatus,
            massResidualStatus,
            energyResidualStatus
        ]);

        return {
            id: definition.id,
            label: definition.label,
            description: definition.description,
            targetRpm: definition.targetRpm,
            throttle: definition.throttle,
            status: statusSummary.status,
            capturedCycleCount: cycles.length,
            meanRpm,
            rpmTrackingErrorPercent,
            meanBoostBarGauge,
            torqueFromPvNm: metrics?.torqueFromPvNm ?? null,
            indicatedTorqueNm: metrics?.meanIndicatedTorqueNm ?? null,
            netImepBar: metrics?.netImepBar ?? null,
            peakPressureBar: representativeCycle?.summary?.peakPressurePa
                * PASCAL_TO_BAR,
            ca50Deg: representativeCycle?.events?.ca50Deg ?? null,
            ca50MeasuredDeg:
                representativeCycle?.events?.ca50MeasuredDeg
                ?? representativeCycle?.events?.ca50Deg
                ?? null,
            ca50ModelDeg:
                representativeCycle?.events?.ca50ModelDeg ?? null,
            ca50TargetDeg:
                representativeCycle?.events?.ca50TargetDeg ?? null,
            pvClosureErrorNm: metrics?.consistencyErrorNm ?? null,
            pvClosureErrorPercent: metrics?.consistencyErrorPercent ?? null,
            pvClosureAssessment,
            repeatabilityCvPercent,
            boostSpanBar,
            boostSlopeBarPerSecond,
            turboRpmSpanPercent,
            maximumMassResidualPercent,
            maximumEnergyResidualPercent,
            checks: {
                cycleValidation: validationReport.status,
                pvClosure: pvClosureAssessment.status,
                rpmTracking: rpmStatus,
                repeatability: repeatabilityStatus,
                boostStability: boostStabilityStatus,
                boostSlope: boostSlopeStatus,
                turboRpmStability: turboRpmStabilityStatus,
                massResidual: massResidualStatus,
                energyResidual: energyResidualStatus
            },
            cycleValidationCounts: validationReport.counts
        };
    }

    async function createMultiPointBaselineState({
                                                     progressStart,
                                                     progressEnd
                                                 }: any) {
        const engine = createAnalysisEngine({
            baseAngleStepDeg: 0.5,
            cycleAngleStepDeg: 0.5,
            cycleHistory: 4,
            captureIntervalSeconds: 0,
            telemetryHistorySeconds: 3
        });

        await startFreshEngine(engine, {
            progressStart,
            progressEnd,
            phaseLabel: "Préparation de la carte multipoint"
        });

        return cloneStateSnapshot(engine.state);
    }

    async function runSingleOperatingPoint({
                                               definition,
                                               baselineState,
                                               progressStart,
                                               progressEnd,
                                               pointIndex,
                                               pointCount
                                           }: any) {
        const engine = createAnalysisEngine({
            baseAngleStepDeg: 0.5,
            cycleAngleStepDeg: 0.5,
            cycleHistory: 12,
            captureIntervalSeconds: 0,
            telemetryHistorySeconds: 20
        });
        restoreStateSnapshot(engine, baselineState, 0.5);

        engine.state.rpm = definition.targetRpm;
        engine.state.dynoMode = DYNO_MODES.RPM_HOLD;
        engine.state.dynoTargetRpm = definition.targetRpm;
        engine.state.dynoRoadLoadEnabled = false;

        const minimumSettlingSeconds = definition.minimumSettlingSeconds
            ?? MULTI_POINT_PROTOCOL.minimumSettlingSeconds;
        const turboStabilityRequired = definition.throttle >= 0.5;
        const stabilityWindow: any = [];
        const capturedCycles: any = [];
        const allTelemetry: any = [];
        const telemetry: any = [];
        let elapsedAtPointSeconds = 0;
        let latestStabilityCvPercent = Infinity;
        let latestBoostSpanBar = Infinity;
        let latestBoostSlopeBarPerSecond = Infinity;
        let latestTurboRpmSpanPercent = Infinity;
        let latestSlowWindowComplete = false;
        let latestRepeatabilityStatus: any = CYCLE_VALIDATION_STATUS.UNAVAILABLE;
        let latestRepeatabilityMeasured = "—";
        let commandedHoldRpm = definition.targetRpm;

        function resetCandidateWindow() {
            stabilityWindow.length = 0;
            latestStabilityCvPercent = Infinity;
            latestBoostSpanBar = Infinity;
            latestRepeatabilityStatus = CYCLE_VALIDATION_STATUS.UNAVAILABLE;
            latestRepeatabilityMeasured = "—";
        }

        engine.telemetry.subscribe(sample => {
            allTelemetry.push(sample);
            if (elapsedAtPointSeconds >= minimumSettlingSeconds) {
                telemetry.push(sample);
            }
        });

        engine.cycleRecorder.subscribe(cycle => {
            if (elapsedAtPointSeconds < minimumSettlingSeconds) {
                return;
            }

            const meanRpm = finite(cycle?.summary?.meanRpm);
            const trackingErrorPercent = Math.abs(definition.targetRpm) > 1e-9
                ? Math.abs(meanRpm - definition.targetRpm)
                / Math.abs(definition.targetRpm) * 100
                : Infinity;

            if (trackingErrorPercent
                > MULTI_POINT_PROTOCOL.rpmTrackingErrorPercentWarning) {
                resetCandidateWindow();
                return;
            }

            const slowStability = getSlowSystemStability(allTelemetry);
            latestSlowWindowComplete = slowStability.complete;
            latestBoostSlopeBarPerSecond
                = slowStability.boostSlopeBarPerSecond;
            latestTurboRpmSpanPercent
                = slowStability.turboRpmSpanPercent;

            const boostSlowStateAccepted = slowStability.complete
                && latestBoostSlopeBarPerSecond
                <= MULTI_POINT_PROTOCOL.boostSlopeBarPerSecondWarning;
            const turboSlowStateAccepted = !turboStabilityRequired
                || (slowStability.complete
                    && latestTurboRpmSpanPercent
                    <= MULTI_POINT_PROTOCOL.turboRpmSpanPercentWarning);

            // Ne pas remplir la fenêtre de cycles tant que les grandeurs lentes
            // restent en transitoire. À 3 500 tr/min cela empêche de retenir le
            // plateau à 0 bar observé avant que le turbo ait fini d'accélérer.
            if (!boostSlowStateAccepted || !turboSlowStateAccepted) {
                resetCandidateWindow();
                return;
            }

            stabilityWindow.push(cycle);
            while (stabilityWindow.length
            > MULTI_POINT_PROTOCOL.stabilityWindowCycles) {
                stabilityWindow.shift();
            }

            latestStabilityCvPercent = cycleStabilityCvPercent(
                stabilityWindow
            );
            latestBoostSpanBar = cycleBoostSpanBar(stabilityWindow);

            if (stabilityWindow.length
                < MULTI_POINT_PROTOCOL.stabilityWindowCycles) {
                return;
            }

            const candidateReport = cycleValidator.validate(cycle, {
                cycleHistory: stabilityWindow,
                convergenceCycles: null
            });
            const repeatabilityTest = candidateReport.tests?.find(
                (test: any) => test.id === "repeatability"
            );
            latestRepeatabilityStatus = repeatabilityTest?.status
                ?? CYCLE_VALIDATION_STATUS.UNAVAILABLE;
            latestRepeatabilityMeasured = repeatabilityTest?.measured ?? "—";

            const candidateAccepted = latestStabilityCvPercent
                <= MULTI_POINT_PROTOCOL.stabilityCvPercentWarning
                && latestBoostSpanBar
                <= MULTI_POINT_PROTOCOL.boostSpanBarWarning
                && latestRepeatabilityStatus !== CYCLE_VALIDATION_STATUS.FAIL
                && latestRepeatabilityStatus !== CYCLE_VALIDATION_STATUS.UNAVAILABLE;

            if (candidateAccepted) {
                capturedCycles.splice(
                    0,
                    capturedCycles.length,
                    ...stabilityWindow
                );
            }
        });

        await simulateDeterministically(engine, {
            maximumSeconds: MULTI_POINT_PROTOCOL.maximumPointSeconds,
            beforeStep: ({ state, elapsedSeconds, stepSeconds }: any) => {
                elapsedAtPointSeconds = elapsedSeconds;
                state.dynoMode = DYNO_MODES.RPM_HOLD;
                state.dynoRoadLoadEnabled = false;

                if (elapsedSeconds >= 0.5) {
                    commandedHoldRpm = clamp(
                        commandedHoldRpm
                        - (state.rpm - definition.targetRpm)
                        * stepSeconds * 0.8,
                        definition.targetRpm
                        - Math.max(400, definition.targetRpm * 0.12),
                        definition.targetRpm + 150
                    );
                }
                state.dynoTargetRpm = commandedHoldRpm;
                state.throttle = definition.throttle * clamp(
                    elapsedSeconds / REFERENCE_PROTOCOL.throttleRampSeconds,
                    0,
                    1
                );
            },
            stopWhen: () =>
                capturedCycles.length
                >= MULTI_POINT_PROTOCOL.capturedCyclesPerPoint,
            progressStart,
            progressEnd,
            onProgress: (progress: any) => setReferenceRunUi({
                phase: `Carte multipoint ${pointIndex}/${pointCount}`,
                progressPercent: progress,
                message: capturedCycles.length
                >= MULTI_POINT_PROTOCOL.capturedCyclesPerPoint
                    ? `${definition.label} · fenêtre de ${capturedCycles.length} cycles acceptée · ${formatNumber(engine.state.rpm)} tr/min`
                    : `${definition.label} · ${elapsedAtPointSeconds < minimumSettlingSeconds ? `préconditionnement ${formatNumber(elapsedAtPointSeconds, 1)}/${formatNumber(minimumSettlingSeconds, 1)} s` : `stabilisation lente ${latestSlowWindowComplete ? "active" : "en acquisition"}`} · ${formatNumber(engine.state.rpm)} tr/min · boost ${formatNumber(engine.state.boost, 2)} bar · turbo ${formatNumber(engine.state.turboRPM / 1000, 1)} krpm · dBoost/dt ${Number.isFinite(latestBoostSlopeBarPerSecond) ? formatNumber(latestBoostSlopeBarPerSecond, 3) : "—"} bar/s · Δturbo ${Number.isFinite(latestTurboRpmSpanPercent) ? formatNumber(latestTurboRpmSpanPercent, 2) : "—"} % · cycles ${stabilityWindow.length}/${MULTI_POINT_PROTOCOL.stabilityWindowCycles} · répétabilité ${latestRepeatabilityMeasured}`
            })
        });

        const result = capturedCycles.length
        < MULTI_POINT_PROTOCOL.capturedCyclesPerPoint
            ? buildOperatingPointResult({
                definition,
                cycles: capturedCycles,
                telemetry,
                error: `Aucune fenêtre de ${MULTI_POINT_PROTOCOL.capturedCyclesPerPoint} cycles n'a satisfait simultanément le régime, la stabilité lente du turbo, le CV, le boost et la répétabilité en ${MULTI_POINT_PROTOCOL.maximumPointSeconds.toFixed(1)} s simulées.`
            })
            : buildOperatingPointResult({
                definition,
                cycles: capturedCycles,
                telemetry
            });

        return {
            result,
            allTelemetry,
            finalStateSnapshot: cloneStateSnapshot(engine.state)
        };
    }

    async function runMultiPointValidationCampaign(referenceValidation: any, {
        progressStart = 60,
        progressEnd = 88
    } = {}) {
        const points: any[] = [...MULTI_POINT_PROTOCOL.points] as any[];
        const baselineEnd = progressStart
            + Math.min(4, (progressEnd - progressStart) * 0.18);
        const baselineState = await createMultiPointBaselineState({
            progressStart,
            progressEnd: baselineEnd
        });
        const results = [];
        const artifacts: { telemetryByPointId: Record<string, any>; stateByPointId: Record<string, any> } = {
            telemetryByPointId: {},
            stateByPointId: {}
        };
        const executablePoints = points.filter(point => !point.reuseReferencePoint);
        const width = (progressEnd - baselineEnd)
            / Math.max(executablePoints.length, 1);
        let executableIndex = 0;

        for (let index = 0; index < points.length; index++) {
            referenceRunCheckpoint();
            const definition = points[index];

            if (definition.reuseReferencePoint) {
                setReferenceRunUi({
                    phase: `Carte multipoint ${index + 1}/${points.length}`,
                    progressPercent: baselineEnd
                        + width * executableIndex,
                    message: `${definition.label} · réutilisation du point déjà stabilisé pour la répétabilité et la convergence.`
                });
                results.push(buildOperatingPointResult({
                    definition,
                    cycles: referenceValidation.repeatabilityCycles,
                    telemetry: referenceValidation.telemetry
                }));
                continue;
            }

            const pointProgressStart = baselineEnd
                + width * executableIndex;
            const pointProgressEnd = baselineEnd
                + width * (executableIndex + 1);
            executableIndex++;

            setReferenceRunUi({
                phase: `Carte multipoint ${index + 1}/${points.length}`,
                progressPercent: pointProgressStart,
                message: `${definition.label} · ${formatNumber(definition.targetRpm)} tr/min · charge ${formatNumber(definition.throttle * 100)} %.`
            });

            try {
                const execution = await runSingleOperatingPoint({
                    definition,
                    baselineState,
                    progressStart: pointProgressStart,
                    progressEnd: pointProgressEnd,
                    pointIndex: index + 1,
                    pointCount: points.length
                });
                results.push(execution.result);
                artifacts.telemetryByPointId[definition.id]
                    = execution.allTelemetry;
                artifacts.stateByPointId[definition.id]
                    = execution.finalStateSnapshot;
            } catch (error) {
                if (error instanceof ReferenceRunCancelledError) throw error;
                console.error(
                    `Operating point ${definition.id} failed:`,
                    error
                );
                results.push(buildOperatingPointResult({
                    definition,
                    error
                }));
            }
        }

        const summary = summarizeValidationStatuses(
            results.map(point => point.status)
        );
        const conclusion = summary.status === CYCLE_VALIDATION_STATUS.PASS
            ? "Campagne multipoint validée sur tous les régimes et charges exécutés."
            : summary.status === CYCLE_VALIDATION_STATUS.WARNING
                ? "Campagne multipoint exploitable, avec au moins un point à surveiller."
                : "Campagne multipoint incomplète ou refusée : au moins un point est en échec.";

        return {
            report: {
                generatedAt: new Date().toISOString(),
                status: summary.status,
                counts: summary.counts,
                points: results,
                protocol: {
                    stabilityWindowCycles:
                    MULTI_POINT_PROTOCOL.stabilityWindowCycles,
                    capturedCyclesPerPoint:
                    MULTI_POINT_PROTOCOL.capturedCyclesPerPoint,
                    minimumSettlingSeconds:
                    MULTI_POINT_PROTOCOL.minimumSettlingSeconds,
                    slowStabilityWindowSeconds:
                    MULTI_POINT_PROTOCOL.slowStabilityWindowSeconds,
                    maximumPointSeconds:
                    MULTI_POINT_PROTOCOL.maximumPointSeconds,
                    angularStepDeg: 0.5
                },
                conclusion
            },
            artifacts
        };
    }


    return {
        setReferenceRunUi,
        referenceRunCheckpoint,
        yieldToBrowser,
        simulateDeterministically,
        startFreshEngine,
        createReferenceSweepRecorder,
        runDeterministicReferenceSweep,
        coefficientOfVariationPercent,
        cycleStabilityCvPercent,
        cycleBoostSpanBar,
        telemetryWindowByDuration,
        telemetryTimeSpanSeconds,
        telemetryAbsoluteSlopePerSecond,
        telemetryRelativeSpanPercent,
        getSlowSystemStability,
        cloneStateSnapshot,
        restoreStateSnapshot,
        runBaseValidationCampaign,
        captureConvergenceCycle,
        runAutomaticValidationCampaign,
        maximumAbsoluteTelemetryValue,
        buildOperatingPointResult,
        createMultiPointBaselineState,
        runSingleOperatingPoint,
        runMultiPointValidationCampaign
    };
}