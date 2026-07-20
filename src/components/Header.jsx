import { useState, useRef, useEffect } from "react";
import { NavLink, useNavigate, useLocation } from "react-router-dom";
import "./Header.css";

const NBA_NAV = [
  { path: "/stats-comparison", label: "Stats Distribution Comparison" },
  { path: "/metrics-comparison", label: "NBA Metrics Player Comparison" },
  { path: "/create-goat-ranking", label: "The NBA GOAT Lab" },
];

const OTHER_SPORTS = [
  { path: "/soccer", label: "Soccer", tag: "GOAT Lab" },
];

export default function Header() {
  const [open, setOpen] = useState(false);
  const menuRef = useRef(null);
  const navigate = useNavigate();
  const location = useLocation();
  const onSoccer = location.pathname.startsWith("/soccer");

  useEffect(() => {
    const onDoc = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  return (
    <header className="header">
      <div className="header-inner">
        <NavLink to={onSoccer ? "/soccer" : "/"} className="header-logo">
          {onSoccer ? (
            <>
              <span className="logo-nba logo-soccer">SOCCER</span>
              <span className="logo-goat logo-goat--soccer">GOAT</span>
            </>
          ) : (
            <>
              <span className="logo-nba">NBA</span>
              <span className="logo-goat">GOAT</span>
            </>
          )}
        </NavLink>

        <nav className="header-nav">
          {(onSoccer
            ? [
                {
                  path: "/soccer/stats-comparison",
                  label: "Stats Distribution Comparison",
                },
                {
                  path: "/soccer/goat-ranking",
                  label: "Soccer GOAT Ranking",
                },
              ]
            : NBA_NAV
          ).map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              className={({ isActive }) =>
                `nav-link ${isActive ? "nav-link--active" : ""}`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="header-sports" ref={menuRef}>
          <button
            type="button"
            className={`sports-menu-btn ${open || onSoccer ? "sports-menu-btn--active" : ""}`}
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-haspopup="menu"
          >
            Other sports
            <span className="sports-menu-caret" aria-hidden>
              ▾
            </span>
          </button>
          {open && (
            <div className="sports-menu" role="menu">
              <button
                type="button"
                className="sports-menu-item"
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  navigate("/");
                }}
              >
                <span className="sports-menu-item-label">NBA</span>
                <span className="sports-menu-item-tag">Current</span>
              </button>
              {OTHER_SPORTS.map((s) => (
                <button
                  key={s.path}
                  type="button"
                  className={`sports-menu-item ${onSoccer ? "sports-menu-item--active" : ""}`}
                  role="menuitem"
                  onClick={() => {
                    setOpen(false);
                    navigate(s.path);
                  }}
                >
                  <span className="sports-menu-item-label">{s.label}</span>
                  <span className="sports-menu-item-tag">{s.tag}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
