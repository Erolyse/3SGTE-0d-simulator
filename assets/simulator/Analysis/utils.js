import { DYNO_MODES } from "../Dyno/Dyno.js";
import { ENGINE_OPERATING_STATES } from "../EngineControl/EngineControl.js";
import { CYCLE_VALIDATION_STATUS } from "./cycle-validation.js";

function finite(value, fallback = 0) {
    return Number.isFinite(value) ? value : fallback;
}

function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
}

function setText(element, text) {
    if (element && element.textContent !== text) {
        element.textContent = text;
    }
}

function setHidden(element, hidden) {
    if (!element) return;

    const shouldHide = Boolean(hidden);
    element.hidden = shouldHide;
    // display est imposé en complément de [hidden] pour éviter toute surcharge CSS.
    element.style.display = shouldHide ? "none" : "grid";
}

function formatNumber(value, decimals = 0) {
    if (!Number.isFinite(value)) {
        return "—";
    }

    return new Intl.NumberFormat("fr-FR", {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals
    }).format(value);
}

function formatScientific(value, decimals = 1) {
    if (!Number.isFinite(value)) {
        return "—";
    }

    if (value === 0) {
        return "0";
    }

    return value.toExponential(decimals).replace("e", " × 10^");
}

function downloadText(filename, content, mimeType = "text/plain") {
    const blob = new Blob([content], { type: `${mimeType};charset=utf-8` });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.style.display = "none";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
}

function dynoModeLabel(mode) {
    switch (mode) {
        case DYNO_MODES.BRAKED:
            return "Freiné";
        case DYNO_MODES.RPM_HOLD:
            return "Régime régulé";
        case DYNO_MODES.INERTIA:
        default:
            return "Inertiel";
    }
}

function engineStatusLabel(state) {
    switch (state.engineOperatingState) {
        case ENGINE_OPERATING_STATES.CRANKING:
            return "Démarrage";
        case ENGINE_OPERATING_STATES.RUNNING:
            return "En marche";
        case ENGINE_OPERATING_STATES.STOPPING:
            return "Arrêt en cours";
        case ENGINE_OPERATING_STATES.STALLED:
            return "Calé";
        case ENGINE_OPERATING_STATES.OFF:
        default:
            return "Arrêté";
    }
}

function validationStatusLabel(status) {
    switch (status) {
        case CYCLE_VALIDATION_STATUS.PASS:
            return "Validé";
        case CYCLE_VALIDATION_STATUS.WARNING:
            return "Avertissement";
        case CYCLE_VALIDATION_STATUS.FAIL:
            return "Échec";
        default:
            return "Non exécuté";
    }
}

function validationStatusRank(status) {
    switch (status) {
        case CYCLE_VALIDATION_STATUS.FAIL:
            return 0;
        case CYCLE_VALIDATION_STATUS.WARNING:
            return 1;
        case CYCLE_VALIDATION_STATUS.PASS:
            return 2;
        default:
            return 3;
    }
}

function summarizeValidationStatuses(statuses) {
    const counts = {
        pass: 0,
        warning: 0,
        fail: 0,
        unavailable: 0
    };

    for (const status of statuses ?? []) {
        if (counts[status] !== undefined) counts[status]++;
    }

    const status = counts.fail > 0
        ? CYCLE_VALIDATION_STATUS.FAIL
        : counts.warning > 0
            ? CYCLE_VALIDATION_STATUS.WARNING
            : counts.pass > 0
                ? CYCLE_VALIDATION_STATUS.PASS
                : CYCLE_VALIDATION_STATUS.UNAVAILABLE;

    return { status, counts };
}

function classifyUpperStatus(value, passMaximum, warningMaximum) {
    if (!Number.isFinite(value)) return CYCLE_VALIDATION_STATUS.UNAVAILABLE;
    if (value <= passMaximum) return CYCLE_VALIDATION_STATUS.PASS;
    if (value <= warningMaximum) return CYCLE_VALIDATION_STATUS.WARNING;
    return CYCLE_VALIDATION_STATUS.FAIL;
}

function escapeHtml(value) {
    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

const escapeHTML = escapeHtml;


export {
    finite, clamp, setText, setHidden, formatNumber, formatScientific,
    downloadText, dynoModeLabel, engineStatusLabel, validationStatusLabel,
    validationStatusRank, summarizeValidationStatuses, classifyUpperStatus,
    escapeHtml, escapeHTML
};
