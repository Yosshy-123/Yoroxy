document.addEventListener("click", e => {
  const a = e.target.closest("a");
  if (a && a.target === "_blank") {
    e.preventDefault();
    window.location.href = a.href;
  }
  const f = e.target.closest("form");
  if (f && f.target === "_blank") {
    e.preventDefault();
    f.target = "_self";
    f.submit();
  }
});