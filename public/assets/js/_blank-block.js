document.addEventListener("click", e => {
  const a = e.target.closest("a");
  if (a && a.href) {
    e.preventDefault();
    window.location.href = a.href;
  }

  const f = e.target.closest("form");
  if (f && f.action) {
    e.preventDefault();
    f.target = "_self";
    f.submit();
  }
});
