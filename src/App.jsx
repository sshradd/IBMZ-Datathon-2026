import { useEffect, useState } from "react";
import Shell from "./components/Shell.jsx";
import { useSetting } from "./lib/settings.js";
import { StoreProvider } from "./lib/store.jsx";
import More from "./pages/More.jsx";
import Outages from "./pages/Outages.jsx";
import Resources from "./pages/Resources.jsx";
import Teams from "./pages/Teams.jsx";
import SurgePage from "./surge/SurgePage.jsx";

// Tabs live in the URL hash (#/teams) so the app stays a static page with no server routes.
const readPath = () => {
  const p = location.hash.replace(/^#/, "") || "/";
  return p.length > 1 ? p.replace(/\/$/, "") : p;
};

export default function App() {
  const [path, setPath] = useState(readPath);
  useSetting("glove", "off", "glove");
  useEffect(() => {
    const on = () => {
      setPath(readPath());
      window.scrollTo(0, 0);
    };
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return (
    <StoreProvider>
      {path === "/" ? (
        <SurgePage />
      ) : (
        <Shell path={path}>
          {path === "/teams" ? <Teams /> : path === "/resources" ? <Resources /> : path === "/more" ? <More /> : <Outages />}
        </Shell>
      )}
    </StoreProvider>
  );
}
