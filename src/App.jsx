import { BrowserRouter, Routes, Route } from "react-router-dom";
import Header from "./components/Header";
import Home from "./pages/Home";
import StatsComparison from "./pages/StatsComparison";
import MetricsComparison from "./pages/MetricsComparison";
import CreateGoatRanking from "./pages/CreateGoatRanking";
import SoccerHome from "./pages/soccer/SoccerHome";
import SoccerStatsComparison from "./pages/soccer/SoccerStatsComparison";
import SoccerGoatRanking from "./pages/soccer/SoccerGoatRanking";
// import DiscoverGoat from "./pages/DiscoverGoat"; // hidden — keep file for future use
// import WembyIndicator from "./pages/WembyIndicator"; // hidden — keep file for future use

export default function App() {
  return (
    <BrowserRouter>
      <Header />
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/stats-comparison" element={<StatsComparison />} />
        <Route path="/metrics-comparison" element={<MetricsComparison />} />
        <Route path="/create-goat-ranking" element={<CreateGoatRanking />} />
        <Route path="/soccer" element={<SoccerHome />} />
        <Route
          path="/soccer/stats-comparison"
          element={<SoccerStatsComparison />}
        />
        <Route
          path="/soccer/goat-ranking"
          element={<SoccerGoatRanking />}
        />
        {/* <Route path="/discover-goat" element={<DiscoverGoat />} /> */}
        {/* <Route path="/wemby-indicator" element={<WembyIndicator />} /> */}
      </Routes>
    </BrowserRouter>
  );
}
