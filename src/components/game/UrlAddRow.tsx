import { useState } from "react";
import "./EditGameModal.css";

export function UrlAddRow({ placeholder, onAdd }: { placeholder: string; onAdd: (url: string) => void }) {
  const [val, setVal] = useState("");
  return (
    <div className="url-add-row">
      <input className="edit-input" type="text" value={val} placeholder={placeholder} onChange={(e) => setVal(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && val.trim()) { onAdd(val.trim()); setVal(""); } }} />
      <button className="lb-apply-btn" onClick={() => { if (val.trim()) { onAdd(val.trim()); setVal(""); } }}>Add</button>
    </div>
  );
}
