/*
 * Numeric layout assertions, built on getBoundingClientRect(). These exist
 * because layout bugs found in this project so far (asymmetric sidebar
 * padding by 1px, a settings radio button off-center by <1px) were only
 * caught by hand-measuring rects — this module makes that measurement a
 * reusable, first-class assertion instead of an ad hoc debugging step.
 *
 * Every function takes Playwright `Locator`s (or a Page/Frame + selector
 * string, for convenience) and throws a descriptive AssertionError.
 */
import assert from 'node:assert/strict';

async function rectOf(target, selector) {
  if (selector !== undefined) {
    // (pageOrFrame, selector) form
    return target.$eval(selector, (e) => {
      const r = e.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width, height: r.height };
    });
  }
  // (locator) form
  return target.evaluate((e) => {
    const r = e.getBoundingClientRect();
    return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width, height: r.height };
  });
}

function centerY(r) {
  return (r.top + r.bottom) / 2;
}
function centerX(r) {
  return (r.left + r.right) / 2;
}

/** Asserts two elements' centers line up on the given axis, within `tolerance` px. */
export async function assertCentered(a, b, axis = 'y', tolerance = 0.5, message = '') {
  const ra = await rectOf(a);
  const rb = await rectOf(b);
  const fn = axis === 'y' ? centerY : centerX;
  const diff = Math.abs(fn(ra) - fn(rb));
  assert.ok(
    diff <= tolerance,
    `${message || `centers differ on ${axis}-axis`}: |${fn(ra).toFixed(2)} - ${fn(rb).toFixed(2)}| = ${diff.toFixed(2)}px > ${tolerance}px`
  );
}

/**
 * Asserts a child's left/right (or top/bottom) gaps to its container are
 * equal, within `tolerance` px. Use axis 'x' for left/right, 'y' for top/bottom.
 */
export async function assertSymmetricPadding(container, child, axis = 'x', tolerance = 0, message = '') {
  const rc = await rectOf(container);
  const rch = await rectOf(child);
  const [gapStart, gapEnd] =
    axis === 'x' ? [rch.left - rc.left, rc.right - rch.right] : [rch.top - rc.top, rc.bottom - rch.bottom];
  const diff = Math.abs(gapStart - gapEnd);
  assert.ok(
    diff <= tolerance,
    `${message || `asymmetric ${axis === 'x' ? 'left/right' : 'top/bottom'} padding`}: start=${gapStart.toFixed(2)}px end=${gapEnd.toFixed(2)}px diff=${diff.toFixed(2)}px > ${tolerance}px`
  );
}

/** Asserts two elements' bounding boxes do not overlap. */
export async function assertNoOverlap(a, b, message = '') {
  const ra = await rectOf(a);
  const rb = await rectOf(b);
  const overlaps = ra.left < rb.right && rb.left < ra.right && ra.top < rb.bottom && rb.top < ra.bottom;
  assert.ok(!overlaps, message || `elements unexpectedly overlap: ${JSON.stringify(ra)} vs ${JSON.stringify(rb)}`);
}

/**
 * Asserts that a row of elements all share (approximately) the same
 * vertical center — i.e. none of them wrapped onto a different line.
 */
export async function assertSameLine(elements, tolerance = 1, message = '') {
  const rects = await Promise.all(elements.map((e) => rectOf(e)));
  const centers = rects.map(centerY);
  const spread = Math.max(...centers) - Math.min(...centers);
  assert.ok(
    spread <= tolerance,
    `${message || 'elements are not on the same line'}: center-y spread = ${spread.toFixed(2)}px > ${tolerance}px (${centers.map((c) => c.toFixed(1)).join(', ')})`
  );
}

export { rectOf };
