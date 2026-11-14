// Shared navigation bar for every Homeward page.
// One file serves both places these pages run:
//   - the local app (http://localhost:3000): first link is the Conflict Tracker at "/"
//   - GitHub Pages: the tracker only runs on your own computer, so the first link
//     is "Homeward" and goes to the project page (index.html)
// Include it as the first thing inside <body>: <script src="nav.js"></script>
(function () {
  const isLocal = location.hostname === "localhost" || location.hostname === "127.0.0.1";
  const here = location.pathname.split("/").pop() || (isLocal ? "" : "index.html");

  const links = [
    isLocal
      ? { href: "/", page: "", label: "Conflict Tracker" }
      : { href: "index.html", page: "index.html", label: "Homeward" },
    { href: "business-map.html", page: "business-map.html", label: "Business Directory" },
    { href: "resources.html", page: "resources.html", label: "Recovery Resources" },
  ];

  const nav = document.createElement("nav");
  nav.className = "site-nav";
  nav.setAttribute("aria-label", "Homeward");
  const list = document.createElement("ul");

  for (const l of links) {
    const a = document.createElement("a");
    a.href = l.href;
    a.textContent = l.label;
    if (l.page === here) a.setAttribute("aria-current", "page");
    const li = document.createElement("li");
    li.append(a);
    list.append(li);
  }

  // External link: new tab, and says it isn't affiliated with Homeward.
  const ext = document.createElement("a");
  ext.href = "https://map.palipost.com";
  ext.target = "_blank";
  ext.rel = "noopener noreferrer";
  ext.title = "Opens in a new tab. Not affiliated with Homeward.";
  ext.className = "external";
  ext.innerHTML = 'Pali Post Rebuild Map <span aria-hidden="true">↗</span>' +
    '<span class="sr-only"> (opens in a new tab; not affiliated with Homeward)</span>';
  const li = document.createElement("li");
  li.className = "external-item";
  li.append(ext);
  list.append(li);

  nav.append(list);
  document.currentScript.before(nav);

  // On narrow screens the row scrolls sideways: make sure the current page's link is visible.
  const current = list.querySelector('[aria-current="page"]');
  if (current && list.scrollWidth > list.clientWidth) {
    list.scrollLeft = current.parentElement.offsetLeft - 12;
  }
})();
