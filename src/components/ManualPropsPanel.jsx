import { memo, useCallback, useEffect, useMemo, useState } from "react";
import PlayerPropCard from "./PlayerPropCard.jsx";
import { styles } from "../theme/styles.js";
import {
  DEFAULT_MANUAL_FORM,
  MANUAL_OFFLINE_REASON,
  MANUAL_PAYOUT_TYPES,
  MANUAL_SIDE_OPTIONS,
  MANUAL_SOURCES,
  MLB_STAT_SUGGESTIONS,
  normalizeManualFormInput,
  selectManualTopPicks,
  sortManualPropsByConfidence,
  validateManualPropFields,
} from "../utils/manualPropBuilder.js";
import { shortReason } from "../utils/formatters.js";

function Field({ label, children, hint = "" }) {
  return (
    <label style={styles.selectLabel}>
      {label}
      {children}
      {hint ? <span style={styles.controlHint}>{hint}</span> : null}
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
  onReanalyzeAll,
  onOpenProp,
  onSavePick,
  compactMode = true,
}) {
  const [form, setForm] = useState(DEFAULT_MANUAL_FORM);
  const [formError, setFormError] = useState("");
  const [analyzedProps, setAnalyzedProps] = useState(() => props || []);
  const [analyzing, setAnalyzing] = useState(false);

  useEffect(() => {
    if (Array.isArray(props) && props.length) {
      setAnalyzedProps(props);
    }
  }, [props]);

  const rankedProps = useMemo(() => sortManualPropsByConfidence(analyzedProps), [analyzedProps]);
  const topPicks = useMemo(() => selectManualTopPicks(analyzedProps, 2), [analyzedProps]);
  const sportOptions = useMemo(() => {
    const sports = new Set(["MLB", ...rankedProps.map((prop) => prop.sport).filter(Boolean)]);
    return Array.from(sports);
  }, [rankedProps]);

  function updateField(key, value) {
    setForm((current) => ({ ...current, [key]: value }));
    if (formError) setFormError("");
  }

  const handleAnalyzeManualProp = useCallback(async () => {
    const manualProp = normalizeManualFormInput(form);
    console.log("Analyze clicked", manualProp);

    setFormError("");
    setAnalyzing(true);
    try {
      const validation = validateManualPropFields(form);
      if (!validation.ok) {
        setFormError(validation.error);
        return;
      }

      const numericLine = Number(manualProp.line);
      if (!Number.isFinite(numericLine) || numericLine <= 0) {
        setFormError("Enter a valid line greater than 0.");
        return;
      }

      let analyzed = null;
      if (typeof onAnalyzeProp === "function") {
        analyzed = await onAnalyzeProp(form);
      }

      if (!analyzed || !analyzed.playerName) {
        throw new Error("Manual analysis did not return a valid prop.");
      }

      console.log("[Manual Analyzer] analyzed prop", analyzed);
      setAnalyzedProps((current) => [analyzed, ...current.filter((row) => row.id !== analyzed.id)]);
      setForm((current) => ({
        ...DEFAULT_MANUAL_FORM,
        sport: current.sport || "MLB",
        source: current.source || "PrizePicks",
        payoutType: current.payoutType || "standard",
      }));
    } catch (error) {
      const message = error?.message || "Manual analysis failed.";
      console.error("[Manual Analyzer]", error);
      setFormError(message);
    } finally {
      setAnalyzing(false);
    }
  }, [form, formError, onAnalyzeProp]);

  function handleFormSubmit(event) {
    event.preventDefault();
    handleAnalyzeManualProp();
  }

  const renderCard = (prop, index) => (
    <div key={prop.id || index} style={{ display: "grid", gap: "4px" }}>
      <PlayerPropCard prop={prop} onOpen={onOpenProp} rank={index + 1} compact={compactMode} />
      <div style={styles.manualPropMetaRow}>
        <span style={styles.manualPropReason}>
          {shortReason(prop) || prop.qualificationReason || prop.whyThisPick || MANUAL_OFFLINE_REASON}
        </span>
        <div style={styles.manualPropActions}>
          <button type="button" style={styles.secondaryButtonSmall} onClick={() => onSavePick?.(prop)}>
            Save
          </button>
          <button
            type="button"
            style={styles.dangerButtonSmall}
            onClick={() => {
              setAnalyzedProps((current) => current.filter((row) => row.id !== prop.id));
              onRemoveProp?.(prop.id);
            }}
          >
            Remove
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="manual-props-panel" style={styles.manualPropsPanel}>
      <section style={styles.section} aria-label="Manual prop entry">
        <div style={styles.sectionHeading}>
          <div>
            <h2 style={styles.sectionTitleSmall}>Manual Prop Analyzer</h2>
            <p className="section-subcopy" style={styles.streakCopy}>
              Enter PrizePicks or Underdog lines for instant mobile-friendly grades.
            </p>
          </div>
          <p style={styles.countPill}>{rankedProps.length} analyzed</p>
        </div>

        <form style={styles.manualPropForm} onSubmit={handleFormSubmit}>
          <div style={styles.manualPropFormGrid}>
            <Field label="Player name">
              <input
                style={styles.textInput}
                value={form.playerName}
                onChange={(event) => updateField("playerName", event.target.value)}
                placeholder="e.g. Michael Busch"
                autoComplete="off"
              />
            </Field>
            <Field label="Sport">
              <select style={styles.select} value={form.sport} onChange={(event) => updateField("sport", event.target.value)}>
                {sportOptions.map((sport) => (
                  <option key={sport} value={sport}>
                    {sport}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Team (optional)" hint="Leave blank if unknown">
              <input
                style={styles.textInput}
                value={form.team}
                onChange={(event) => updateField("team", event.target.value)}
                placeholder="CHC"
                autoComplete="off"
              />
            </Field>
            <Field label="Opponent (optional)" hint="Leave blank if unknown">
              <input
                style={styles.textInput}
                value={form.opponent}
                onChange={(event) => updateField("opponent", event.target.value)}
                placeholder="Optional"
                autoComplete="off"
              />
            </Field>
            <Field label="Stat type">
              <input
                style={styles.textInput}
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
                style={styles.textInput}
                type="number"
                min="0"
                step="0.5"
                value={form.line}
                onChange={(event) => updateField("line", event.target.value)}
                placeholder="5.5"
              />
            </Field>
            <Field label="Pick">
              <select style={styles.select} value={form.side} onChange={(event) => updateField("side", event.target.value)}>
                {MANUAL_SIDE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Source">
              <select style={styles.select} value={form.source} onChange={(event) => updateField("source", event.target.value)}>
                {MANUAL_SOURCES.map((source) => (
                  <option key={source} value={source}>
                    {source}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Line type">
              <select
                style={styles.select}
                value={form.payoutType}
                onChange={(event) => updateField("payoutType", event.target.value)}
              >
                {MANUAL_PAYOUT_TYPES.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          {formError ? (
            <p style={styles.manualPropFormError} role="alert">
              {formError}
            </p>
          ) : null}

          <div style={styles.manualPropFormActions}>
            <button
              type="button"
              style={styles.refreshButton}
              disabled={loading || analyzing}
              onClick={handleAnalyzeManualProp}
            >
              {loading || analyzing ? "Analyzing…" : "Analyze prop"}
            </button>
            {rankedProps.length ? (
              <>
                <button type="button" style={styles.secondaryButton} onClick={() => onReanalyzeAll?.()}>
                  Re-analyze all
                </button>
                <button
                  type="button"
                  style={styles.dangerButton}
                  onClick={() => {
                    setAnalyzedProps([]);
                    onClearAll?.();
                  }}
                >
                  Clear all
                </button>
              </>
            ) : null}
          </div>
        </form>

        {notice ? <p style={styles.streakNotice}>{notice}</p> : null}
      </section>

      {topPicks.length ? (
        <section style={styles.section} aria-label="Manual top picks">
          <div style={styles.sectionHeading}>
            <div>
              <h2 style={styles.sectionTitleSmall}>Top 2 Manual Picks</h2>
              <p className="section-subcopy" style={styles.streakCopy}>Best edge and lowest volatility from your board.</p>
            </div>
            <p style={styles.countPill}>{topPicks.length} picks</p>
          </div>
          <div style={styles.manualTopPickGrid}>{topPicks.map((prop, index) => renderCard(prop, index))}</div>
        </section>
      ) : null}

      <section style={styles.section} aria-label="Analyzed manual props">
        <div style={styles.sectionHeading}>
          <div>
            <h2 style={styles.sectionTitleSmall}>Analyzed Props</h2>
            <p className="section-subcopy" style={styles.streakCopy}>Ranked by edge, volatility, and confidence.</p>
          </div>
          <p style={styles.countPill}>{rankedProps.length} ranked</p>
        </div>
        {!rankedProps.length ? (
          <div style={styles.emptyStateCompact}>Add a prop above to generate your first grade.</div>
        ) : (
          <div style={styles.manualTopPickGrid}>{rankedProps.map((prop, index) => renderCard(prop, index))}</div>
        )}
      </section>
    </div>
  );
}

export default memo(ManualPropsPanel);
