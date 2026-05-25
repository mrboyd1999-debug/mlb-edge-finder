import { memo, useCallback, useMemo, useState } from "react";
import CompactPropCard from "./CompactPropCard.jsx";
import {
  DEFAULT_MANUAL_FORM,
  MANUAL_PAYOUT_TYPES,
  MANUAL_SIDE_OPTIONS,
  MANUAL_SOURCES,
  MLB_STAT_SUGGESTIONS,
  validateManualPropFields,
} from "../utils/manualPropBuilder.js";

function Field({ label, children, hint = "" }) {
  return (
    <label className="compact-form-field">
      <span className="compact-form-field__label">{label}</span>
      {children}
      {hint ? <span className="compact-form-field__hint">{hint}</span> : null}
    </label>
  );
}

function ManualPropsPanel({
  props = [],
  loading = false,
  notice = "",
  onAnalyzeProp,
  onRemoveProp,
  onClearAll,
  onOpenProp,
  onSavePick,
}) {
  const [form, setForm] = useState({ ...DEFAULT_MANUAL_FORM, side: "over" });
  const [formError, setFormError] = useState("");
  const [editingId, setEditingId] = useState(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [latestResult, setLatestResult] = useState(null);

  const rankedProps = useMemo(
    () => [...(props || [])].sort((a, b) => Number(b.confidenceScore ?? 0) - Number(a.confidenceScore ?? 0)),
    [props]
  );
  const displayResult = latestResult || rankedProps[0] || null;

  function updateField(key, value) {
    setForm((current) => ({ ...current, [key]: value }));
    if (formError) setFormError("");
  }

  function handleEditProp(prop = {}) {
    setForm({
      playerName: prop.playerName || "",
      sport: prop.sport || "MLB",
      team: prop.team || "",
      opponent: prop.opponent || "",
      statType: prop.statType || "",
      line: prop.line != null ? String(prop.line) : "",
      side: prop.side || prop.bestPick || prop.pick || "over",
      source: prop.source || prop.platform || "PrizePicks",
      payoutType: prop.oddsType || prop.payoutRole || prop.payoutType || "standard",
    });
    setEditingId(prop.id || null);
    setLatestResult(prop);
    setFormError("");
  }

  const handleAnalyzeManualProp = useCallback(async () => {
    setFormError("");
    setAnalyzing(true);
    try {
      const validation = validateManualPropFields(form);
      if (!validation.ok) {
        setFormError(validation.error);
        return;
      }

      let analyzed = null;
      if (typeof onAnalyzeProp === "function") {
        analyzed = await onAnalyzeProp({ ...form, editingId });
      }

      if (!analyzed || !analyzed.playerName) {
        console.warn("[Manual Analyzer] empty analyzer response — check API/fallback logs");
        setFormError("Analysis returned no result. Check console for API or fallback details.");
        return;
      }

      setLatestResult(analyzed);
      setEditingId(null);
      setForm((current) => ({
        ...DEFAULT_MANUAL_FORM,
        sport: current.sport || "MLB",
        source: current.source || "PrizePicks",
        payoutType: current.payoutType || "standard",
        side: current.side || "over",
      }));
    } catch (error) {
      console.error("[Manual Analyzer] analyze failed", error);
      setFormError(error?.message || "Manual analysis failed.");
    } finally {
      setAnalyzing(false);
    }
  }, [form, editingId, onAnalyzeProp]);

  function handleFormSubmit(event) {
    event.preventDefault();
    handleAnalyzeManualProp();
  }

  return (
    <div className="compact-manual-panel">
      <form className="compact-manual-form" onSubmit={handleFormSubmit}>
        <div className="compact-manual-form__grid">
          <Field label="Player name">
            <input
              className="compact-input"
              value={form.playerName}
              onChange={(event) => updateField("playerName", event.target.value)}
              placeholder="Nolan McLean"
              autoComplete="off"
            />
          </Field>
          <Field label="Team">
            <input
              className="compact-input"
              value={form.team}
              onChange={(event) => updateField("team", event.target.value)}
              placeholder="NYM"
              autoComplete="off"
            />
          </Field>
          <Field label="Opponent">
            <input
              className="compact-input"
              value={form.opponent}
              onChange={(event) => updateField("opponent", event.target.value)}
              placeholder="PHI"
              autoComplete="off"
            />
          </Field>
          <Field label="Prop type">
            <input
              className="compact-input"
              list="manual-stat-suggestions"
              value={form.statType}
              onChange={(event) => updateField("statType", event.target.value)}
              placeholder="Pitcher Strikeouts"
              autoComplete="off"
            />
            <datalist id="manual-stat-suggestions">
              {MLB_STAT_SUGGESTIONS.map((stat) => (
                <option key={stat} value={stat} />
              ))}
            </datalist>
          </Field>
          <Field label="Line">
            <input
              className="compact-input"
              type="number"
              min="0"
              step="0.5"
              value={form.line}
              onChange={(event) => updateField("line", event.target.value)}
              placeholder="7.5"
            />
          </Field>
          <Field label="Side">
            <select className="compact-input" value={form.side || "over"} onChange={(event) => updateField("side", event.target.value)}>
              {MANUAL_SIDE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Source">
            <select className="compact-input" value={form.source} onChange={(event) => updateField("source", event.target.value)}>
              {MANUAL_SOURCES.map((source) => (
                <option key={source} value={source}>
                  {source}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Payout type">
            <select className="compact-input" value={form.payoutType} onChange={(event) => updateField("payoutType", event.target.value)}>
              {MANUAL_PAYOUT_TYPES.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </Field>
        </div>

        {formError ? (
          <p className="compact-form-error" role="alert">
            {formError}
          </p>
        ) : null}
        {notice ? <p className="compact-form-notice">{notice}</p> : null}

        <button type="submit" className="compact-analyze-btn" disabled={loading || analyzing}>
          {loading || analyzing ? "Analyzing…" : "Analyze"}
        </button>
      </form>

      {displayResult ? (
        <section className="compact-section" aria-label="Analysis result">
          <div className="compact-section__head">
            <h2>Analysis Result</h2>
            <p>Phase 1 MLB manual grade — tap card for details</p>
          </div>
          <CompactPropCard
            prop={displayResult}
            onOpen={onOpenProp}
            onSave={onSavePick}
            defaultExpanded
            showSave
          />
          <div className="compact-manual-actions">
            <button type="button" className="compact-prop-card__btn" onClick={() => handleEditProp(displayResult)}>
              Edit
            </button>
            {displayResult.id ? (
              <button type="button" className="compact-prop-card__btn compact-prop-card__btn--danger" onClick={() => onRemoveProp?.(displayResult.id)}>
                Remove
              </button>
            ) : null}
          </div>
        </section>
      ) : (
        <p className="compact-empty">Enter a prop and tap Analyze to grade it.</p>
      )}

      {rankedProps.length > 1 ? (
        <details className="compact-recent-details">
          <summary>Recent analyzed props ({rankedProps.length})</summary>
          <div className="compact-card-list">
            {rankedProps.slice(0, 8).map((prop, index) => (
              <CompactPropCard key={prop.id || index} prop={prop} rank={index + 1} onOpen={onOpenProp} onSave={onSavePick} />
            ))}
          </div>
          {rankedProps.length ? (
            <button type="button" className="compact-prop-card__btn compact-prop-card__btn--danger" onClick={() => onClearAll?.()}>
              Clear session list
            </button>
          ) : null}
        </details>
      ) : null}
    </div>
  );
}

export default memo(ManualPropsPanel);
