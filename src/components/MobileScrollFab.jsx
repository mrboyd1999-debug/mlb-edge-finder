import { memo } from "react";

function MobileScrollFab({ onScrollTop, onScrollTo }) {
  return (
    <div className="mobile-scroll-fab" aria-label="Quick scroll">
      <button type="button" className="mobile-scroll-fab-btn" onClick={onScrollTop} aria-label="Scroll to top">
        <span className="mobile-scroll-fab-icon" aria-hidden="true">↑</span>
      </button>
      <button type="button" className="mobile-scroll-fab-btn" onClick={() => onScrollTo?.("section-top-picks")} aria-label="Scroll to Top Picks">
        <span className="mobile-scroll-fab-icon" aria-hidden="true">★</span>
      </button>
      <button type="button" className="mobile-scroll-fab-btn" onClick={() => onScrollTo?.("section-accepted")} aria-label="Scroll to Accepted Props">
        <span className="mobile-scroll-fab-icon" aria-hidden="true">✓</span>
      </button>
    </div>
  );
}

export default memo(MobileScrollFab);
