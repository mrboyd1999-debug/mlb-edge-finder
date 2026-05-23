import { memo, useEffect, useRef, useState } from "react";

/** Defer mounting heavy sections until near the viewport. */
function LazyBelowFold({ children, placeholderHeight = 8 }) {
  const ref = useRef(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) return undefined;
    if (typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return undefined;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "240px 0px" }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={ref} className="lazy-below-fold">
      {visible ? children : <div style={{ minHeight: placeholderHeight }} aria-hidden="true" />}
    </div>
  );
}

export default memo(LazyBelowFold);
