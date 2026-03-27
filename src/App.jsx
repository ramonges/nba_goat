import { BrowserRouter, Routes, Route } from "react-router-dom";
import Header from "./components/Header";
import Home from "./pages/Home";
import StatsComparison from "./pages/StatsComparison";

export default function App() {
  return (
    <BrowserRouter>
      <Header />
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/stats-comparison" element={<StatsComparison />} />
      </Routes>
    </BrowserRouter>
  );
}
