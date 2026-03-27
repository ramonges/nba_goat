import { NavLink } from "react-router-dom";
import "./Header.css";

const NAV_ITEMS = [
  { path: "/stats-comparison", label: "Stats Distribution Comparison" },
];

export default function Header() {
  return (
    <header className="header">
      <div className="header-inner">
        <NavLink to="/" className="header-logo">
          <span className="logo-nba">NBA</span>
          <span className="logo-goat">GOAT</span>
        </NavLink>

        <nav className="header-nav">
          {NAV_ITEMS.map((item) => (
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
      </div>
    </header>
  );
}
