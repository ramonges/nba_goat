import { useState, useRef, useEffect } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import "./Header.css";

const NBA_NAV = [
  { path: "/stats-comparison", label: "Stats Distribution Comparison" },
  { path: "/metrics-comparison", label: "NBA Metrics Player Comparison" },
  { path: "/create-goat-ranking", label: "The NBA GOAT Lab" },
  { path: "/goat-animation", label: "NBA GOAT Animation" },
];

export default function Header() {
  const [open, setOpen] = useState(false);
  const menuRef = useRef(null);
  const navigate = useNavigate();

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
        <NavLink to="/" className="header-logo">
          <span className="logo-nba">NBA</span>
          <span className="logo-goat">GOAT</span>
        </NavLink>

        <nav className="header-nav">
          {NBA_NAV.map((item) => (
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
            className={`sports-menu-btn ${open ? "sports-menu-btn--active" : ""}`}
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
              <div
                className="sports-menu-item sports-menu-item--soon"
                role="menuitem"
                aria-disabled="true"
              >
                <span className="sports-menu-item-label">WNBA</span>
                <span className="sports-menu-item-tag">Coming soon</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
