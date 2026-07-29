import { DYNO_MODES } from "../Dyno/Dyno.js";
import { REV_LIMITER_CUT_RPM, REV_LIMITER_RESUME_RPM } from "../EngineControl/EngineControl.js";
import {
    REFERENCE_PROTOCOL, TRANSIENT_PROTOCOL, TRANSIENT_TELEMETRY_CHANNELS
} from "./config.js";
import {
    finite, clamp, setText, formatNumber, escapeHtml, validationStatusLabel,
    summarizeValidationStatuses, classifyUpperStatus
} from "./utils.js";
import { CYCLE_VALIDATION_STATUS } from "./cycle-validation.js";
import { createAnalysisEngine } from "./engine-factory.js";
import { ReferenceRunCancelledError } from "./errors.js";

export function createTransientCampaignModule({
                                                  liveData, ui, restoreStateSnapshot, setReferenceRunUi, simulateDeterministically
                                              }: any) {
    function createTransientEngine() {
        return createAnalysisEngine({
            baseAngleStepDeg: 0.5,
            cycleAngleStepDeg: 0.5,
            cycleHistory: 1,
            captureIntervalSeconds: 0,
            telemetryHistorySeconds: 12,
            telemetryChannels: TRANSIENT_TELEMETRY_CHANNELS,
            cycleRecorderEnabled: false
        });
    }

    function telemetryFiniteValues(samples: any, key: any, {
        minimumTime = Number.NEGATIVE_INFINITY,
        maximumTime = Number.POSITIVE_INFINITY
    } = {}) {
        return (samples ?? [])
            .filter((sample: any) =>
                finite(sample?.time, Number.NEGATIVE_INFINITY) >= minimumTime
                && finite(sample?.time, Number.POSITIVE_INFINITY) <= maximumTime
            )
            .map((sample: any) => sample?.[key])
            .filter(Number.isFinite);
    }

    function telemetryMaximumValue(samples: any, key: any) {
        const values = telemetryFiniteValues(samples, key);
        return values.length ? Math.max(...values) : NaN;
    }

    function telemetryMinimumValue(samples: any, key: any) {
        const values = telemetryFiniteValues(samples, key);
        return values.length ? Math.min(...values) : NaN;
    }

    function telemetryMeanLastSeconds(samples: any, key: any, durationSeconds: any) {
        const lastTime = finite(samples?.at(-1)?.time, NaN);
        if (!Number.isFinite(lastTime)) return NaN;
        const values = telemetryFiniteValues(samples, key, {
            minimumTime: lastTime - Math.max(durationSeconds, 0)
        });
        return values.length
            ? values.reduce((sum: any, value: any) => sum + value, 0) / values.length
            : NaN;
    }

    function thresholdCrossingTime(samples: any, key: any, threshold: any, {
        direction = "up",
        minimumTime = 0
    } = {}) {
        for (const sample of samples ?? []) {
            if (finite(sample?.time, -Infinity) < minimumTime) continue;
            const value = sample?.[key];
            if (!Number.isFinite(value)) continue;
            if (direction === "down" ? value <= threshold : value >= threshold) {
                return sample.time;
            }
        }
        return NaN;
    }

    function booleanActivationTime(samples: any, key: any, minimumTime = 0) {
        for (const sample of samples ?? []) {
            if (finite(sample?.time, -Infinity) < minimumTime) continue;
            if (Boolean(sample?.[key])) return sample.time;
        }
        return NaN;
    }

    function transientCheck({
                                id,
                                scenario,
                                label,
                                status,
                                measured,
                                expected,
                                value = null,
                                unit = "",
                                detail = ""
                            }: any) {
        return {
            id,
            scenario,
            label,
            status,
            statusLabel: validationStatusLabel(status),
            measured,
            expected,
            value,
            unit,
            detail
        };
    }

    function upperTransientCheck({
                                     id,
                                     scenario,
                                     label,
                                     value,
                                     pass,
                                     warning,
                                     unit,
                                     digits = 3,
                                     detail = ""
                                 }: any) {
        return transientCheck({
            id,
            scenario,
            label,
            value,
            unit,
            status: classifyUpperStatus(value, pass, warning),
            measured: Number.isFinite(value)
                ? `${formatNumber(value, digits)} ${unit}`.trim()
                : "Non atteint",
            expected:
                `≤ ${formatNumber(pass, digits)} ${unit} validé · `
                + `≤ ${formatNumber(warning, digits)} ${unit} avertissement`,
            detail
        });
    }

    function lowerTransientCheck({
                                     id,
                                     scenario,
                                     label,
                                     value,
                                     pass,
                                     warning,
                                     unit,
                                     digits = 3,
                                     detail = ""
                                 }: any) {
        const status = !Number.isFinite(value)
            ? CYCLE_VALIDATION_STATUS.UNAVAILABLE
            : value >= pass
                ? CYCLE_VALIDATION_STATUS.PASS
                : value >= warning
                    ? CYCLE_VALIDATION_STATUS.WARNING
                    : CYCLE_VALIDATION_STATUS.FAIL;
        return transientCheck({
            id,
            scenario,
            label,
            value,
            unit,
            status,
            measured: Number.isFinite(value)
                ? `${formatNumber(value, digits)} ${unit}`.trim()
                : "Non mesuré",
            expected:
                `≥ ${formatNumber(pass, digits)} ${unit} validé · `
                + `≥ ${formatNumber(warning, digits)} ${unit} avertissement`,
            detail
        });
    }

    function booleanTransientCheck({
                                       id,
                                       scenario,
                                       label,
                                       pass,
                                       measured,
                                       expected,
                                       detail = ""
                                   }: any) {
        return transientCheck({
            id,
            scenario,
            label,
            value: Boolean(pass),
            status: pass
                ? CYCLE_VALIDATION_STATUS.PASS
                : CYCLE_VALIDATION_STATUS.FAIL,
            measured,
            expected,
            detail
        });
    }

    function scenarioFromChecks({
                                    id,
                                    label,
                                    description,
                                    metrics,
                                    checks
                                }: any) {
        const summary = summarizeValidationStatuses(
            checks.map((check: any) => check.status)
        );
        if (summary.status === CYCLE_VALIDATION_STATUS.PASS
            && summary.counts.unavailable > 0) {
            summary.status = CYCLE_VALIDATION_STATUS.WARNING;
        }
        return {
            id,
            label,
            description,
            status: summary.status,
            counts: summary.counts,
            metrics,
            checks
        };
    }

    function failedTransientScenario(id: any, label: any, description: any, error: any) {
        const message = error?.message ?? String(error ?? "Données indisponibles");
        return scenarioFromChecks({
            id,
            label,
            description,
            metrics: {},
            checks: [transientCheck({
                id: `${id}-available`,
                scenario: label,
                label: "Scénario exécutable",
                status: CYCLE_VALIDATION_STATUS.FAIL,
                measured: message,
                expected: "État stabilisé et télémétrie disponibles",
                detail: "Le tir continue afin de conserver les résultats des autres scénarios."
            })]
        });
    }

    function analyzeSpoolTransient(samples: any) {
        const scenario = "Montée en charge et spool à 3 500 tr/min";
        const startTime = thresholdCrossingTime(
            samples,
            "boost",
            TRANSIENT_PROTOCOL.spoolStartBoostBar
        );
        const targetTime = thresholdCrossingTime(
            samples,
            "boost",
            TRANSIENT_PROTOCOL.spoolTargetBoostBar
        );
        const riseTime = Number.isFinite(startTime) && Number.isFinite(targetTime)
            ? Math.max(targetTime - startTime, 0)
            : NaN;
        const maximumBoostBar = telemetryMaximumValue(samples, "boost");
        const finalBoostBar = telemetryMeanLastSeconds(samples, "boost", 0.5);
        const maximumTurboRpm = telemetryMaximumValue(samples, "turboRPM");
        const maximumMassResidualPercent = telemetryMaximumValue(
            samples,
            "maximumMassResidualPercent"
        );
        const maximumEnergyResidualPercent = telemetryMaximumValue(
            samples,
            "maximumEnergyResidualPercent"
        );

        const checks = [
            booleanTransientCheck({
                id: "spool-target-reached",
                scenario,
                label: "Boost cible transitoire atteint",
                pass: Number.isFinite(targetTime),
                measured: Number.isFinite(targetTime)
                    ? `${formatNumber(targetTime, 3)} s`
                    : "0,65 bar non atteint",
                expected: `Atteindre ${formatNumber(TRANSIENT_PROTOCOL.spoolTargetBoostBar, 2)} bar relatifs`,
                detail: "La mesure provient de la rampe de charge du point multipoint à 3 500 tr/min."
            }),
            upperTransientCheck({
                id: "spool-command-to-target",
                scenario,
                label: "Temps commande → boost cible",
                value: targetTime,
                pass: TRANSIENT_PROTOCOL.spoolCommandToTargetSecondsPass,
                warning: TRANSIENT_PROTOCOL.spoolCommandToTargetSecondsWarning,
                unit: "s",
                detail: "Temps depuis le début de la rampe de papillon jusqu’à 0,65 bar."
            }),
            upperTransientCheck({
                id: "spool-rise-time",
                scenario,
                label: "Temps de montée 0,10 → 0,65 bar",
                value: riseTime,
                pass: TRANSIENT_PROTOCOL.spoolRiseSecondsPass,
                warning: TRANSIENT_PROTOCOL.spoolRiseSecondsWarning,
                unit: "s",
                detail: "Évite de confondre le délai initial et la vitesse de montée effective."
            }),
            upperTransientCheck({
                id: "spool-maximum-boost",
                scenario,
                label: "Surpression maximale pendant le spool",
                value: maximumBoostBar,
                pass: TRANSIENT_PROTOCOL.maximumBoostBarPass,
                warning: TRANSIENT_PROTOCOL.maximumBoostBarWarning,
                unit: "bar",
                detail: `Boost final moyen : ${formatNumber(finalBoostBar, 3)} bar relatifs.`
            }),
            upperTransientCheck({
                id: "spool-maximum-turbo-rpm",
                scenario,
                label: "Régime turbo maximal",
                value: maximumTurboRpm,
                pass: TRANSIENT_PROTOCOL.maximumTurboRpmPass,
                warning: TRANSIENT_PROTOCOL.maximumTurboRpmWarning,
                unit: "tr/min",
                digits: 0,
                detail: "La limite d’avertissement correspond à la garde de survitesse du modèle."
            }),
            upperTransientCheck({
                id: "spool-mass-residual",
                scenario,
                label: "Résidu massique maximal",
                value: maximumMassResidualPercent,
                pass: TRANSIENT_PROTOCOL.massResidualPercentPass,
                warning: TRANSIENT_PROTOCOL.massResidualPercentWarning,
                unit: "%",
                digits: 6
            }),
            upperTransientCheck({
                id: "spool-energy-residual",
                scenario,
                label: "Résidu énergétique maximal",
                value: maximumEnergyResidualPercent,
                pass: TRANSIENT_PROTOCOL.energyResidualPercentPass,
                warning: TRANSIENT_PROTOCOL.energyResidualPercentWarning,
                unit: "%",
                digits: 6
            })
        ];

        return scenarioFromChecks({
            id: "spool-3500",
            label: scenario,
            description: "Rampe de papillon déterministe, montée de pression et accélération de l’arbre turbo.",
            metrics: {
                boostStartTimeSeconds: startTime,
                boostTargetTimeSeconds: targetTime,
                boostRiseTimeSeconds: riseTime,
                maximumBoostBar,
                finalBoostBar,
                maximumTurboRpm,
                maximumMassResidualPercent,
                maximumEnergyResidualPercent
            },
            checks
        });
    }

    function analyzeWastegateTransient(regulationSamples: any, causalSamples: any) {
        const scenario = "Ouverture causale et régulation de wastegate";

        const triggerSamples = Array.isArray(causalSamples)
            ? causalSamples
            : [];
        const firstTriggerSample = triggerSamples.find(sample =>
            Number.isFinite(sample?.wastegatePosition)
            && Number.isFinite(sample?.boost)
        );
        const initialWastegatePosition = firstTriggerSample?.wastegatePosition;
        const initialBoostBar = firstTriggerSample?.boost;
        const initiallyClosed = Number.isFinite(initialWastegatePosition)
            && initialWastegatePosition
            <= TRANSIENT_PROTOCOL.wastegateInitialClosedMaximum;

        // La causalité est mesurée sur la rampe pleine charge à 3 500 tr/min :
        // elle commence depuis l'état de base, avec wastegate fermée. La capacité
        // de régulation à fort débit reste évaluée sur le point 5 500 tr/min.
        const boostCrackTime = thresholdCrossingTime(
            triggerSamples,
            "boost",
            0.65
        );
        const wastegateOpenTime = thresholdCrossingTime(
            triggerSamples,
            "wastegatePosition",
            TRANSIENT_PROTOCOL.wastegateOpenThreshold
        );
        const rawResponseTime = Number.isFinite(boostCrackTime)
        && Number.isFinite(wastegateOpenTime)
            ? wastegateOpenTime - boostCrackTime
            : NaN;
        const causalOrderValid = initiallyClosed
            && Number.isFinite(rawResponseTime)
            && rawResponseTime >= 0;
        const responseTime = causalOrderValid
            ? rawResponseTime
            : NaN;

        const maximumPosition = telemetryMaximumValue(
            regulationSamples,
            "wastegatePosition"
        );
        const maximumMassFlow = telemetryMaximumValue(
            regulationSamples,
            "wastegateMassFlow"
        );
        const maximumBoostBar = telemetryMaximumValue(
            regulationSamples,
            "boost"
        );
        const maximumTurboRpm = telemetryMaximumValue(
            regulationSamples,
            "turboRPM"
        );

        const checks = [
            booleanTransientCheck({
                id: "wastegate-initially-closed",
                scenario,
                label: "État initial causal",
                pass: initiallyClosed,
                measured: Number.isFinite(initialWastegatePosition)
                    ? `${formatNumber(initialWastegatePosition * 100, 2)} % d’ouverture · ${formatNumber(initialBoostBar, 3)} bar`
                    : "État initial indisponible",
                expected:
                    `wastegate ≤ ${formatNumber(TRANSIENT_PROTOCOL.wastegateInitialClosedMaximum * 100, 1)} % avant la montée de pression`,
                detail: "Le délai n’est accepté que si l’actionneur part réellement d’un état fermé."
            }),
            booleanTransientCheck({
                id: "wastegate-causal-order",
                scenario,
                label: "Ordre pression → ouverture",
                pass: causalOrderValid,
                measured: Number.isFinite(rawResponseTime)
                    ? `Δt brut ${formatNumber(rawResponseTime, 3)} s`
                    : "Franchissements incomplets",
                expected: "0,65 bar franchi avant 5 % d’ouverture",
                detail: "Aucun clamp à zéro n’est appliqué : un délai négatif provoque un échec."
            }),
            upperTransientCheck({
                id: "wastegate-response",
                scenario,
                label: "Délai causal pression → ouverture",
                value: responseTime,
                pass: TRANSIENT_PROTOCOL.wastegateResponseSecondsPass,
                warning: TRANSIENT_PROTOCOL.wastegateResponseSecondsWarning,
                unit: "s",
                detail: "Mesuré pendant la rampe de charge à 3 500 tr/min, depuis une wastegate vérifiée fermée."
            }),
            lowerTransientCheck({
                id: "wastegate-position",
                scenario,
                label: "Ouverture à fort débit",
                value: maximumPosition,
                pass: TRANSIENT_PROTOCOL.wastegateOpenThreshold,
                warning: 0.02,
                unit: "fraction",
                detail: "Maximum mesuré sur le point régulé à 5 500 tr/min."
            }),
            lowerTransientCheck({
                id: "wastegate-mass-flow",
                scenario,
                label: "Débit dérivé maximal",
                value: maximumMassFlow,
                pass: TRANSIENT_PROTOCOL.wastegateMinimumMassFlowKgS,
                warning: 0.001,
                unit: "kg/s",
                detail: "Une position ouverte sans débit physique serait incohérente."
            }),
            upperTransientCheck({
                id: "wastegate-maximum-boost",
                scenario,
                label: "Boost maximal régulé",
                value: maximumBoostBar,
                pass: TRANSIENT_PROTOCOL.maximumBoostBarPass,
                warning: TRANSIENT_PROTOCOL.maximumBoostBarWarning,
                unit: "bar"
            }),
            upperTransientCheck({
                id: "wastegate-maximum-turbo-rpm",
                scenario,
                label: "Régime turbo maximal",
                value: maximumTurboRpm,
                pass: TRANSIENT_PROTOCOL.maximumTurboRpmPass,
                warning: TRANSIENT_PROTOCOL.maximumTurboRpmWarning,
                unit: "tr/min",
                digits: 0
            })
        ];

        return scenarioFromChecks({
            id: "wastegate-5500",
            label: scenario,
            description:
                "Déclenchement causal vérifié sur la rampe 3 500 tr/min ; "
                + "capacité de régulation et débit vérifiés à 5 500 tr/min.",
            metrics: {
                initialWastegatePosition,
                initialBoostBar,
                initiallyClosed,
                boostCrackTimeSeconds: boostCrackTime,
                wastegateOpenTimeSeconds: wastegateOpenTime,
                wastegateRawResponseTimeSeconds: rawResponseTime,
                wastegateResponseTimeSeconds: responseTime,
                causalOrderValid,
                maximumWastegatePosition: maximumPosition,
                maximumWastegateMassFlowKgS: maximumMassFlow,
                maximumBoostBar,
                maximumTurboRpm
            },
            checks
        });
    }

    async function runLiftOffAndReapplicationTransient(seedState: any, {
        progressStart,
        progressEnd
    }: any) {
        if (!seedState) {
            throw new Error("État stabilisé à 4 000 tr/min indisponible.");
        }

        const engine = createTransientEngine();
        restoreStateSnapshot(engine, seedState, 0.5);
        engine.state.dynoMode = DYNO_MODES.RPM_HOLD;
        engine.state.dynoTargetRpm = 4000;
        engine.state.dynoRoadLoadEnabled = false;

        const liftSamples: any = [];
        const unsubscribeLift = engine.telemetry.subscribe(sample => {
            liftSamples.push(sample);
        });
        const turboRpmBeforeLift = finite(engine.state.turboRPM);
        const boostBeforeLift = finite(engine.state.boost);

        await simulateDeterministically(engine, {
            maximumSeconds: TRANSIENT_PROTOCOL.liftOffSeconds,
            beforeStep: ({ state }: any) => {
                state.dynoMode = DYNO_MODES.RPM_HOLD;
                state.dynoTargetRpm = 4000;
                state.dynoRoadLoadEnabled = false;
                state.throttle = 0;
            },
            progressStart,
            progressEnd: progressStart + (progressEnd - progressStart) * 0.42,
            onProgress: (progress: any) => setReferenceRunUi({
                phase: "Transitoire — lever de pied",
                progressPercent: progress,
                message: `Lever de pied à 4 000 tr/min · bypass ${formatNumber(engine.state.compressorBypassValvePosition * 100, 0)} % · boost ${formatNumber(engine.state.boost, 2)} bar`
            })
        });
        unsubscribeLift?.();

        const bypassOpeningTime = thresholdCrossingTime(
            liftSamples,
            "compressorBypassValvePosition",
            TRANSIENT_PROTOCOL.bypassOpenThreshold
        );
        const boostReleaseTime = thresholdCrossingTime(
            liftSamples,
            "boost",
            TRANSIENT_PROTOCOL.boostReleasedThresholdBar,
            { direction: "down" }
        );
        const fuelCutTime = booleanActivationTime(liftSamples, "fuelCutActive");
        const finalFuelConsumptionLh = telemetryMeanLastSeconds(
            liftSamples,
            "instantFuelConsumptionLh",
            0.5
        );
        const finalTorqueNm = telemetryMeanLastSeconds(
            liftSamples,
            "torque",
            0.5
        );
        const finalTurboRpm = telemetryMeanLastSeconds(
            liftSamples,
            "turboRPM",
            0.25
        );
        const turboSpeedReductionPercent = turboRpmBeforeLift > 1e-9
            ? Math.max(turboRpmBeforeLift - finalTurboRpm, 0)
            / turboRpmBeforeLift * 100
            : NaN;
        const maximumMassResidualPercent = telemetryMaximumValue(
            liftSamples,
            "maximumMassResidualPercent"
        );
        const maximumEnergyResidualPercent = telemetryMaximumValue(
            liftSamples,
            "maximumEnergyResidualPercent"
        );

        const liftChecks = [
            upperTransientCheck({
                id: "lift-bypass-opening",
                scenario: "Lever de pied sous boost",
                label: "Ouverture du bypass",
                value: bypassOpeningTime,
                pass: TRANSIENT_PROTOCOL.bypassOpeningSecondsPass,
                warning: TRANSIENT_PROTOCOL.bypassOpeningSecondsWarning,
                unit: "s",
                detail: `Boost initial : ${formatNumber(boostBeforeLift, 3)} bar.`
            }),
            upperTransientCheck({
                id: "lift-boost-release",
                scenario: "Lever de pied sous boost",
                label: "Retour sous 0,10 bar",
                value: boostReleaseTime,
                pass: TRANSIENT_PROTOCOL.boostReleaseSecondsPass,
                warning: TRANSIENT_PROTOCOL.boostReleaseSecondsWarning,
                unit: "s"
            }),
            upperTransientCheck({
                id: "lift-fuel-cut",
                scenario: "Lever de pied sous boost",
                label: "Activation de la coupure d’injection",
                value: fuelCutTime,
                pass: TRANSIENT_PROTOCOL.fuelCutSecondsPass,
                warning: TRANSIENT_PROTOCOL.fuelCutSecondsWarning,
                unit: "s"
            }),
            upperTransientCheck({
                id: "lift-final-fuel",
                scenario: "Lever de pied sous boost",
                label: "Consommation après coupure",
                value: finalFuelConsumptionLh,
                pass: TRANSIENT_PROTOCOL.finalFuelConsumptionLhPass,
                warning: TRANSIENT_PROTOCOL.finalFuelConsumptionLhWarning,
                unit: "L/h",
                detail: "Moyenne des 0,5 dernières secondes."
            }),
            booleanTransientCheck({
                id: "lift-engine-braking",
                scenario: "Lever de pied sous boost",
                label: "Couple de frein moteur",
                pass: Number.isFinite(finalTorqueNm) && finalTorqueNm < 0,
                measured: Number.isFinite(finalTorqueNm)
                    ? `${formatNumber(finalTorqueNm, 2)} N·m`
                    : "Non mesuré",
                expected: "Couple moyen final négatif",
                detail: "Moyenne des 0,5 dernières secondes."
            }),
            lowerTransientCheck({
                id: "lift-turbo-deceleration",
                scenario: "Lever de pied sous boost",
                label: "Décélération de l’arbre turbo",
                value: turboSpeedReductionPercent,
                pass: 20,
                warning: 10,
                unit: "%",
                detail: `${formatNumber(turboRpmBeforeLift, 0)} → ${formatNumber(finalTurboRpm, 0)} tr/min.`
            }),
            upperTransientCheck({
                id: "lift-mass-residual",
                scenario: "Lever de pied sous boost",
                label: "Résidu massique maximal",
                value: maximumMassResidualPercent,
                pass: TRANSIENT_PROTOCOL.massResidualPercentPass,
                warning: TRANSIENT_PROTOCOL.massResidualPercentWarning,
                unit: "%",
                digits: 6
            }),
            upperTransientCheck({
                id: "lift-energy-residual",
                scenario: "Lever de pied sous boost",
                label: "Résidu énergétique maximal",
                value: maximumEnergyResidualPercent,
                pass: TRANSIENT_PROTOCOL.energyResidualPercentPass,
                warning: TRANSIENT_PROTOCOL.energyResidualPercentWarning,
                unit: "%",
                digits: 6
            })
        ];

        const liftScenario = scenarioFromChecks({
            id: "lift-off-4000",
            label: "Lever de pied sous boost",
            description: "Fermeture brusque du papillon, ouverture du bypass, coupure carburant et frein moteur.",
            metrics: {
                boostBeforeLiftBar: boostBeforeLift,
                turboRpmBeforeLift,
                bypassOpeningTimeSeconds: bypassOpeningTime,
                boostReleaseTimeSeconds: boostReleaseTime,
                fuelCutTimeSeconds: fuelCutTime,
                finalFuelConsumptionLh,
                finalTorqueNm,
                finalTurboRpm,
                turboSpeedReductionPercent,
                maximumMassResidualPercent,
                maximumEnergyResidualPercent
            },
            checks: liftChecks
        });

        engine.telemetry.clear?.({ resetTime: true });
        const reapplicationSamples: any = [];
        const unsubscribeReapplication = engine.telemetry.subscribe(sample => {
            reapplicationSamples.push(sample);
        });

        await simulateDeterministically(engine, {
            maximumSeconds: TRANSIENT_PROTOCOL.reapplicationSeconds,
            beforeStep: ({ state, elapsedSeconds }: any) => {
                state.dynoMode = DYNO_MODES.RPM_HOLD;
                state.dynoTargetRpm = 4000;
                state.dynoRoadLoadEnabled = false;
                state.throttle = clamp(
                    elapsedSeconds
                    / TRANSIENT_PROTOCOL.reapplicationRampSeconds,
                    0,
                    1
                );
            },
            progressStart: progressStart + (progressEnd - progressStart) * 0.42,
            progressEnd,
            onProgress: (progress: any) => setReferenceRunUi({
                phase: "Transitoire — reprise de charge",
                progressPercent: progress,
                message: `Reprise de charge · bypass ${formatNumber(engine.state.compressorBypassValvePosition * 100, 0)} % · boost ${formatNumber(engine.state.boost, 2)} bar`
            })
        });
        unsubscribeReapplication?.();

        const bypassClosingTime = thresholdCrossingTime(
            reapplicationSamples,
            "compressorBypassValvePosition",
            TRANSIENT_PROTOCOL.bypassClosedThreshold,
            { direction: "down" }
        );
        const boostRecoveryTime = thresholdCrossingTime(
            reapplicationSamples,
            "boost",
            TRANSIENT_PROTOCOL.reapplicationTargetBoostBar
        );
        const maximumBoostBar = telemetryMaximumValue(
            reapplicationSamples,
            "boost"
        );
        const maximumTurboRpm = telemetryMaximumValue(
            reapplicationSamples,
            "turboRPM"
        );

        const reapplicationChecks = [
            upperTransientCheck({
                id: "reapplication-bypass-closing",
                scenario: "Reprise de charge",
                label: "Fermeture du bypass",
                value: bypassClosingTime,
                pass: TRANSIENT_PROTOCOL.bypassClosingSecondsPass,
                warning: TRANSIENT_PROTOCOL.bypassClosingSecondsWarning,
                unit: "s"
            }),
            upperTransientCheck({
                id: "reapplication-boost-recovery",
                scenario: "Reprise de charge",
                label: "Retour à 0,50 bar",
                value: boostRecoveryTime,
                pass: TRANSIENT_PROTOCOL.boostRecoverySecondsPass,
                warning: TRANSIENT_PROTOCOL.boostRecoverySecondsWarning,
                unit: "s"
            }),
            upperTransientCheck({
                id: "reapplication-maximum-boost",
                scenario: "Reprise de charge",
                label: "Boost maximal à la reprise",
                value: maximumBoostBar,
                pass: TRANSIENT_PROTOCOL.maximumBoostBarPass,
                warning: TRANSIENT_PROTOCOL.maximumBoostBarWarning,
                unit: "bar"
            }),
            upperTransientCheck({
                id: "reapplication-maximum-turbo-rpm",
                scenario: "Reprise de charge",
                label: "Régime turbo maximal",
                value: maximumTurboRpm,
                pass: TRANSIENT_PROTOCOL.maximumTurboRpmPass,
                warning: TRANSIENT_PROTOCOL.maximumTurboRpmWarning,
                unit: "tr/min",
                digits: 0
            })
        ];

        const reapplicationScenario = scenarioFromChecks({
            id: "reapplication-4000",
            label: "Reprise de charge",
            description: "Fermeture du bypass et reconstruction de la pression après le lever de pied.",
            metrics: {
                bypassClosingTimeSeconds: bypassClosingTime,
                boostRecoveryTimeSeconds: boostRecoveryTime,
                maximumBoostBar,
                maximumTurboRpm
            },
            checks: reapplicationChecks
        });

        return [liftScenario, reapplicationScenario];
    }

    async function runRevLimiterTransient(seedState: any, {
        progressStart,
        progressEnd
    }: any) {
        if (!seedState) {
            throw new Error("État stabilisé haut régime indisponible.");
        }

        const engine = createTransientEngine();
        restoreStateSnapshot(engine, seedState, 0.5);
        engine.state.rpm = REV_LIMITER_CUT_RPM + 25;
        engine.state.dynoMode = DYNO_MODES.INERTIA;
        engine.state.dynoRoadLoadEnabled = false;
        engine.state.throttle = 1;

        const samples: any = [];
        engine.telemetry.subscribe(sample => samples.push(sample));
        const initialEventCount = finite(engine.state.revLimiterEventCount);
        let activationTime = NaN;
        let injectionCutTime = NaN;
        let resumeTime = NaN;
        let maximumRpm = finite(engine.state.rpm);
        let previousLimiterState = Boolean(engine.state.revLimiterActive);

        await simulateDeterministically(engine, {
            maximumSeconds: TRANSIENT_PROTOCOL.revLimiterMaximumSeconds,
            beforeStep: ({ state }: any) => {
                state.dynoMode = DYNO_MODES.INERTIA;
                state.dynoRoadLoadEnabled = false;
                state.throttle = 1;
            },
            afterStep: ({ state, elapsedSeconds }: any) => {
                maximumRpm = Math.max(maximumRpm, finite(state.rpm));
                if (!Number.isFinite(activationTime)
                    && state.revLimiterActive) {
                    activationTime = elapsedSeconds;
                }
                if (!Number.isFinite(injectionCutTime)
                    && Array.isArray(state.cylinderFuelEnabled)
                    && state.cylinderFuelEnabled.every((enabled: any) => !enabled)) {
                    injectionCutTime = elapsedSeconds;
                }
                if (Number.isFinite(activationTime)
                    && !Number.isFinite(resumeTime)
                    && previousLimiterState
                    && !state.revLimiterActive) {
                    resumeTime = elapsedSeconds;
                }
                previousLimiterState = Boolean(state.revLimiterActive);
            },
            stopWhen: () => Number.isFinite(resumeTime),
            progressStart,
            progressEnd,
            onProgress: (progress: any) => setReferenceRunUi({
                phase: "Transitoire — rupteur",
                progressPercent: progress,
                message: `Rupteur · ${formatNumber(engine.state.rpm)} tr/min · coupure ${engine.state.revLimiterActive ? "active" : "libre"}`
            })
        });

        const eventCountDelta = finite(engine.state.revLimiterEventCount)
            - initialEventCount;
        const maximumMassResidualPercent = telemetryMaximumValue(
            samples,
            "maximumMassResidualPercent"
        );
        const maximumEnergyResidualPercent = telemetryMaximumValue(
            samples,
            "maximumEnergyResidualPercent"
        );

        const scenario = "Intervention du rupteur";
        const checks = [
            upperTransientCheck({
                id: "limiter-activation",
                scenario,
                label: "Activation de la coupure",
                value: activationTime,
                pass: TRANSIENT_PROTOCOL.revLimiterActivationSecondsPass,
                warning: TRANSIENT_PROTOCOL.revLimiterActivationSecondsWarning,
                unit: "s",
                detail: `État initial imposé à ${REV_LIMITER_CUT_RPM + 25} tr/min pour tester le seuil.`
            }),
            upperTransientCheck({
                id: "limiter-injection-cut",
                scenario,
                label: "Suppression de l’injection sur les cylindres",
                value: injectionCutTime,
                pass: 0.05,
                warning: 0.10,
                unit: "s",
                detail: "Temps nécessaire pour que les quatre décisions d’injection de cycle soient désactivées."
            }),
            upperTransientCheck({
                id: "limiter-resume",
                scenario,
                label: "Retour sous le seuil de reprise",
                value: resumeTime,
                pass: TRANSIENT_PROTOCOL.revLimiterResumeSecondsPass,
                warning: TRANSIENT_PROTOCOL.revLimiterResumeSecondsWarning,
                unit: "s",
                detail: `Seuil de reprise : ${REV_LIMITER_RESUME_RPM} tr/min.`
            }),
            upperTransientCheck({
                id: "limiter-maximum-rpm",
                scenario,
                label: "Dépassement maximal du régime",
                value: maximumRpm,
                pass: TRANSIENT_PROTOCOL.maximumEngineRpmPass,
                warning: TRANSIENT_PROTOCOL.maximumEngineRpmWarning,
                unit: "tr/min",
                digits: 0
            }),
            booleanTransientCheck({
                id: "limiter-event-count",
                scenario,
                label: "Événement de rupteur enregistré",
                pass: eventCountDelta >= 1,
                measured: `${formatNumber(eventCountDelta, 0)} événement(s)`,
                expected: "Au moins un événement"
            }),
            booleanTransientCheck({
                id: "limiter-released",
                scenario,
                label: "Hystérésis de reprise",
                pass: Number.isFinite(resumeTime)
                    && engine.state.rpm <= REV_LIMITER_RESUME_RPM + 30
                    && !engine.state.revLimiterActive,
                measured: Number.isFinite(resumeTime)
                    ? `${formatNumber(engine.state.rpm, 0)} tr/min · libre`
                    : `${formatNumber(engine.state.rpm, 0)} tr/min · coupure maintenue`,
                expected: `Reprise autour de ${REV_LIMITER_RESUME_RPM} tr/min`
            }),
            upperTransientCheck({
                id: "limiter-mass-residual",
                scenario,
                label: "Résidu massique maximal",
                value: maximumMassResidualPercent,
                pass: TRANSIENT_PROTOCOL.massResidualPercentPass,
                warning: TRANSIENT_PROTOCOL.massResidualPercentWarning,
                unit: "%",
                digits: 6
            }),
            upperTransientCheck({
                id: "limiter-energy-residual",
                scenario,
                label: "Résidu énergétique maximal",
                value: maximumEnergyResidualPercent,
                pass: TRANSIENT_PROTOCOL.energyResidualPercentPass,
                warning: TRANSIENT_PROTOCOL.energyResidualPercentWarning,
                unit: "%",
                digits: 6
            })
        ];

        return scenarioFromChecks({
            id: "rev-limiter",
            label: scenario,
            description: "Activation de la coupure, décélération et reprise selon l’hystérésis 7 000 / 6 800 tr/min.",
            metrics: {
                activationTimeSeconds: activationTime,
                injectionCutTimeSeconds: injectionCutTime,
                resumeTimeSeconds: resumeTime,
                maximumRpm,
                eventCountDelta,
                finalRpm: finite(engine.state.rpm),
                maximumMassResidualPercent,
                maximumEnergyResidualPercent
            },
            checks
        });
    }

    async function runTransientValidationCampaign(artifacts: any, {
        progressStart = 88,
        progressEnd = 99
    } = {}) {
        const scenarios = [];
        const telemetryByPointId = artifacts?.telemetryByPointId ?? {};
        const stateByPointId = artifacts?.stateByPointId ?? {};

        setReferenceRunUi({
            phase: "Campagne transitoire",
            progressPercent: progressStart,
            message: "Analyse du spool et de la causalité de wastegate à partir des rampes multipoints."
        });

        try {
            const samples = telemetryByPointId[TRANSIENT_PROTOCOL.spoolPointId];
            if (!Array.isArray(samples) || samples.length < 2) {
                throw new Error("Télémétrie du point 3 500 tr/min indisponible.");
            }
            scenarios.push(analyzeSpoolTransient(samples));
        } catch (error) {
            scenarios.push(failedTransientScenario(
                "spool-3500",
                "Montée en charge et spool à 3 500 tr/min",
                "Rampe de papillon et montée de pression.",
                error
            ));
        }

        try {
            const regulationSamples =
                telemetryByPointId[TRANSIENT_PROTOCOL.wastegatePointId];
            const causalSamples =
                telemetryByPointId[TRANSIENT_PROTOCOL.spoolPointId];
            if (!Array.isArray(regulationSamples)
                || regulationSamples.length < 2) {
                throw new Error("Télémétrie du point 5 500 tr/min indisponible.");
            }
            if (!Array.isArray(causalSamples)
                || causalSamples.length < 2) {
                throw new Error("Rampe causale du point 3 500 tr/min indisponible.");
            }
            scenarios.push(analyzeWastegateTransient(
                regulationSamples,
                causalSamples
            ));
        } catch (error) {
            scenarios.push(failedTransientScenario(
                "wastegate-5500",
                "Ouverture causale et régulation de wastegate",
                "Déclenchement causal à 3 500 tr/min et régulation à 5 500 tr/min.",
                error
            ));
        }

        setReferenceRunUi({
            phase: "Campagne transitoire",
            progressPercent: progressStart + (progressEnd - progressStart) * 0.16,
            message: "Lever de pied sous boost, bypass, coupure d’injection et reprise de charge."
        });

        try {
            scenarios.push(...await runLiftOffAndReapplicationTransient(
                stateByPointId[TRANSIENT_PROTOCOL.liftOffPointId],
                {
                    progressStart: progressStart
                        + (progressEnd - progressStart) * 0.16,
                    progressEnd: progressStart
                        + (progressEnd - progressStart) * 0.72
                }
            ));
        } catch (error) {
            if (error instanceof ReferenceRunCancelledError) throw error;
            scenarios.push(failedTransientScenario(
                "lift-off-4000",
                "Lever de pied sous boost",
                "Ouverture du bypass, coupure carburant et frein moteur.",
                error
            ));
            scenarios.push(failedTransientScenario(
                "reapplication-4000",
                "Reprise de charge",
                "Fermeture du bypass et reconstruction du boost.",
                error
            ));
        }

        setReferenceRunUi({
            phase: "Campagne transitoire",
            progressPercent: progressStart + (progressEnd - progressStart) * 0.72,
            message: "Intervention du rupteur et vérification de l’hystérésis."
        });

        try {
            scenarios.push(await runRevLimiterTransient(
                stateByPointId[TRANSIENT_PROTOCOL.revLimiterPointId]
                ?? stateByPointId[TRANSIENT_PROTOCOL.wastegatePointId],
                {
                    progressStart: progressStart
                        + (progressEnd - progressStart) * 0.72,
                    progressEnd
                }
            ));
        } catch (error) {
            if (error instanceof ReferenceRunCancelledError) throw error;
            scenarios.push(failedTransientScenario(
                "rev-limiter",
                "Intervention du rupteur",
                "Coupure, décélération et reprise par hystérésis.",
                error
            ));
        }

        const checks = scenarios.flatMap(scenario => scenario.checks);
        const summary = summarizeValidationStatuses(
            checks.map(check => check.status)
        );
        if (summary.status === CYCLE_VALIDATION_STATUS.PASS
            && summary.counts.unavailable > 0) {
            summary.status = CYCLE_VALIDATION_STATUS.WARNING;
        }

        const conclusion = summary.status === CYCLE_VALIDATION_STATUS.PASS
            ? "Tous les scénarios transitoires ont satisfait les critères définis."
            : summary.status === CYCLE_VALIDATION_STATUS.WARNING
                ? "Les transitoires restent exploitables, avec au moins une réponse à surveiller."
                : "Au moins un comportement transitoire est en échec ou n’a pas pu être exécuté.";

        return {
            generatedAt: new Date().toISOString(),
            status: summary.status,
            counts: summary.counts,
            scenarios,
            checks,
            protocol: {
                physicsCallStepSeconds: REFERENCE_PROTOCOL.physicsCallStepSeconds,
                angularStepDeg: 0.5,
                spoolPointId: TRANSIENT_PROTOCOL.spoolPointId,
                liftOffPointId: TRANSIENT_PROTOCOL.liftOffPointId,
                wastegatePointId: TRANSIENT_PROTOCOL.wastegatePointId,
                revLimiterPointId: TRANSIENT_PROTOCOL.revLimiterPointId,
                liftOffSeconds: TRANSIENT_PROTOCOL.liftOffSeconds,
                reapplicationSeconds: TRANSIENT_PROTOCOL.reapplicationSeconds,
                revLimiterMaximumSeconds:
                TRANSIENT_PROTOCOL.revLimiterMaximumSeconds
            },
            conclusion
        };
    }

    function clearTransientValidationReport() {
        liveData.transientValidation = null;
        setText(ui.transientValidationGlobalStatus, "En attente");
        setText(
            ui.transientValidationSummary,
            "La campagne sera exécutée pendant le prochain tir de référence."
        );
        setText(ui.transientValidationSummaryBadge, "En attente");
        setText(ui.transientValidationTimestamp, "—");
        setText(
            ui.transientValidationConclusion,
            "Aucun scénario transitoire n’a encore été exécuté."
        );
        if (ui.transientValidationTableBody) {
            ui.transientValidationTableBody.innerHTML = `
                <tr class="cycle-validation-empty-row">
                    <td colspan="5">Lancez un tir de référence pour exécuter les transitoires.</td>
                </tr>
            `;
        }
        if (ui.transientValidationExportButton) {
            ui.transientValidationExportButton.disabled = true;
        }
        const panel = ui.transientValidationGlobalStatus
            ?.closest(".transient-validation");
        if (panel) panel.dataset.validationStatus = "unavailable";
    }

    function renderTransientValidationReport(report: any = null) {
        if (!report) {
            clearTransientValidationReport();
            return;
        }

        liveData.transientValidation = report;
        const panel = ui.transientValidationGlobalStatus
            ?.closest(".transient-validation");
        if (panel) panel.dataset.validationStatus = report.status;

        setText(
            ui.transientValidationGlobalStatus,
            validationStatusLabel(report.status)
        );
        setText(
            ui.transientValidationSummary,
            `${report.counts.pass} validé(s) · `
            + `${report.counts.warning} avertissement(s) · `
            + `${report.counts.fail} échec(s) · `
            + `${report.counts.unavailable} non exécuté(s)`
        );
        setText(
            ui.transientValidationSummaryBadge,
            report.status === CYCLE_VALIDATION_STATUS.PASS
                ? `${report.counts.pass}/${report.checks.length} validés`
                : report.status === CYCLE_VALIDATION_STATUS.WARNING
                    ? `${report.counts.warning} avertissement(s)`
                    : `${report.counts.fail} échec(s)`
        );
        setText(
            ui.transientValidationTimestamp,
            new Date(report.generatedAt).toLocaleString("fr-FR")
        );
        setText(ui.transientValidationConclusion, report.conclusion);

        if (ui.transientValidationTableBody) {
            ui.transientValidationTableBody.innerHTML = report.scenarios
                .flatMap((scenario: any) => scenario.checks.map((check: any, index: any) => `
                    <tr data-test-status="${escapeHtml(check.status)}">
                        ${index === 0
                    ? `<td rowspan="${scenario.checks.length}">
                                <strong>${escapeHtml(scenario.label)}</strong>
                                <span>${escapeHtml(scenario.description)}</span>
                               </td>`
                    : ""}
                        <td>
                            <strong>${escapeHtml(check.label)}</strong>
                            ${check.detail
                    ? `<span>${escapeHtml(check.detail)}</span>`
                    : ""}
                        </td>
                        <td>${escapeHtml(check.measured)}</td>
                        <td>${escapeHtml(check.expected)}</td>
                        <td class="cycle-validation-status">
                            ${escapeHtml(check.statusLabel)}
                        </td>
                    </tr>
                `)).join("");
        }

        if (ui.transientValidationExportButton) {
            ui.transientValidationExportButton.disabled = false;
        }
    }

    function transientValidationToCsv(report: any) {
        if (!report?.checks?.length) return "";
        const csvCell = (value: any) =>
            `"${String(value ?? "").replaceAll('"', '""')}"`;
        return [
            [
                "scenario",
                "controle",
                "statut",
                "valeur_mesuree",
                "critere",
                "detail"
            ].map(csvCell).join(";"),
            ...report.checks.map((check: any) => [
                check.scenario,
                check.label,
                check.status,
                check.measured,
                check.expected,
                check.detail
            ].map(csvCell).join(";"))
        ].join("\n");
    }


    return {
        createTransientEngine,
        telemetryFiniteValues,
        telemetryMaximumValue,
        telemetryMinimumValue,
        telemetryMeanLastSeconds,
        thresholdCrossingTime,
        booleanActivationTime,
        transientCheck,
        upperTransientCheck,
        lowerTransientCheck,
        booleanTransientCheck,
        scenarioFromChecks,
        failedTransientScenario,
        analyzeSpoolTransient,
        analyzeWastegateTransient,
        runLiftOffAndReapplicationTransient,
        runRevLimiterTransient,
        runTransientValidationCampaign,
        clearTransientValidationReport,
        renderTransientValidationReport,
        transientValidationToCsv
    };
}