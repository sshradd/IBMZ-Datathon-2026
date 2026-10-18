import { ShieldAlert, Users, Radar } from "lucide-react";
import { Dock, DockIcon, DockItem, DockLabel } from "./Dock.jsx";

// The dock IS the map-layer switcher: Risk / Exposure / Coverage.
const modes = [
  { name: "Risk",     icon: ShieldAlert },
  { name: "Exposure", icon: Users },
  { name: "Coverage", icon: Radar },
];

export default function ModeDock({ mode, setMode }) {
  return (
    <div className="dock-wrap in-map">
      <Dock magnification={72} distance={120}>
        {modes.map(({ name, icon: Icon }) => (
          <DockItem key={name} className={mode === name ? "active" : ""} onClick={() => setMode(name)}>
            <DockLabel>{name}</DockLabel>
            <DockIcon><Icon /></DockIcon>
          </DockItem>
        ))}
      </Dock>
    </div>
  );
}