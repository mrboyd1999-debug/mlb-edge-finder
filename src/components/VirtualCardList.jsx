import { memo, useCallback, useEffect, useRef, useState } from "react";
import { styles } from "../theme/styles.js";

const DEFAULT_PLACEHOLDER_HEIGHT = 108;
const LAZY_ROOT_MARGIN = "240px 0px";

function LazyCardSlot({ prop, index, eager, renderCard }) {
  const ref = useRef(null);
  const [visible, setVisible] = useState(eager);

  useEffect(() => {
    if (visible) return undefined;
    const node = ref.current;
    if (!node) return undefined;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: LAZY_ROOT_MARGIN }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [visible]);

  return (
    <div ref={ref} style={{ minHeight: visible ? undefined : DEFAULT_PLACEHOLDER_HEIGHT }}>
      {visible ? renderCard(prop, index) : null}
    </div>
  );
}

function VirtualCardList({
  items = [],
  renderCard,
  initialVisible = 10,
  pageSize = 10,
  gridStyle,
  emptyText = "No picks to show.",
}) {
  const [limit, setLimit] = useState(initialVisible);
  const visibleItems = items.slice(0, limit);
  const render = useCallback((prop, index) => renderCard(prop, index), [renderCard]);

  if (!items.length) {
    return <div style={styles.emptyState}>{emptyText}</div>;
  }

  return (
    <>
      <div style={gridStyle || styles.cardGridCompact}>
        {visibleItems.map((prop, index) => (
          <LazyCardSlot
            key={prop.id || `${prop.playerName}-${index}`}
            prop={prop}
            index={index}
            eager={index < initialVisible}
            renderCard={render}
          />
        ))}
      </div>
      {limit < items.length ? (
        <button
          type="button"
          style={{ ...styles.secondaryButton, marginTop: "8px" }}
          onClick={() => setLimit((current) => Math.min(current + pageSize, items.length))}
        >
          Load more ({visibleItems.length}/{items.length})
        </button>
      ) : null}
    </>
  );
}

export default memo(VirtualCardList);
