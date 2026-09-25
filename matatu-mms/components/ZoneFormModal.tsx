"use client";

import { useState } from "react";
import { MapPin, Plus, X } from "lucide-react";
import PolygonBoundaryEditor, { BoundaryResult } from "./PolygonBoundaryEditor";
import { createZoneAction, updateZoneAction } from "@/lib/actions";
import { Sector, Zone } from "@/lib/types";

/**
 * Create-or-edit form for a duty Zone, with the map-drawn boundary as one
 * step of the form rather than a separate page — the boundary is optional
 * (a zone can exist as a name/sector pairing with no geography yet, same as
 * the four legacy corridor zones), so this doesn't force drawing a shape to
 * save a zone.
 */
export default function ZoneFormModal({ sectors, existing }: { sectors: Sector[]; existing?: Zone }) {
  const [isOpen, setIsOpen] = useState(false);
  const [name, setName] = useState(existing?.name || "");
  const [code, setCode] = useState(existing?.code || "");
  const [sectorId, setSectorId] = useState(existing?.sectorId || "");
  const [description, setDescription] = useState(existing?.description || "");
  const [boundary, setBoundary] = useState<BoundaryResult | null>(
    existing?.boundaryGeojson && existing.centerLat != null && existing.centerLng != null
      ? { boundaryGeojson: existing.boundaryGeojson, centerLat: existing.centerLat, centerLng: existing.centerLng }
      : null
  );
  const [showMap, setShowMap] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setError("Give this zone a name.");
      return;
    }
    setError(null);
    setIsPending(true);
    const input = {
      name: name.trim(),
      description: description.trim() || undefined,
      sectorId: sectorId || undefined,
      code: code.trim() || undefined,
      centerLat: boundary?.centerLat,
      centerLng: boundary?.centerLng,
      boundaryGeojson: boundary?.boundaryGeojson,
    };
    const result = existing ? await updateZoneAction(existing.id, input) : await createZoneAction(input);
    setIsPending(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    setIsOpen(false);
  }

  return (
    <>
      <button
        onClick={() => setIsOpen(true)}
        className={
          existing
            ? "text-xs font-bold text-county-green hover:underline"
            : "rounded-lg px-3.5 py-2 text-xs font-bold bg-county-green text-white hover:bg-county-green-dark transition-colors flex items-center gap-1.5"
        }
      >
        {existing ? (
          "Edit"
        ) : (
          <>
            <Plus size={14} strokeWidth={2.5} />
            New Zone
          </>
        )}
      </button>

      {isOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 space-y-4 shadow-2xl relative max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center border-b pb-3">
              <h3 className="font-extrabold text-base text-county-black">{existing ? "Edit Zone" : "New Zone"}</h3>
              <button onClick={() => setIsOpen(false)} aria-label="Close" className="text-black/40 hover:text-black">
                <X size={18} strokeWidth={2} />
              </button>
            </div>

            {error && (
              <div className="bg-county-red/10 border border-county-red/30 text-county-red text-xs p-3 rounded-lg font-semibold">
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-3.5">
              <div>
                <label className="label">Zone name</label>
                <input value={name} onChange={(e) => setName(e.target.value)} required placeholder="e.g. Kasarani North" className="input" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Code (optional)</label>
                  <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="e.g. Z-12" className="input font-mono" />
                </div>
                <div>
                  <label className="label">Sector</label>
                  <select value={sectorId} onChange={(e) => setSectorId(e.target.value)} className="input">
                    <option value="">No sector</option>
                    {sectors.map((s) => (
                      <option key={s.id} value={s.id}>{s.code} — {s.name}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label className="label">Description (optional)</label>
                <input value={description} onChange={(e) => setDescription(e.target.value)} className="input" />
              </div>

              <div>
                <div className="flex items-center justify-between">
                  <label className="label !mb-0">Boundary</label>
                  <button
                    type="button"
                    onClick={() => setShowMap((v) => !v)}
                    className="text-xs font-bold text-county-green hover:underline flex items-center gap-1"
                  >
                    <MapPin size={12} strokeWidth={2.5} />
                    {boundary ? "Edit on map" : showMap ? "Hide map" : "Draw on map"}
                  </button>
                </div>
                {boundary && !showMap && (
                  <p className="text-[11px] text-county-green font-semibold mt-1">Boundary set — click "Edit on map" to change it.</p>
                )}
                {!boundary && !showMap && (
                  <p className="text-[11px] text-black/40 mt-1">Optional — a zone can be saved without a drawn boundary.</p>
                )}
                {showMap && (
                  <div className="mt-2">
                    <PolygonBoundaryEditor
                      existingGeojson={boundary?.boundaryGeojson}
                      onSave={(result) => {
                        setBoundary(result);
                        setShowMap(false);
                      }}
                      onCancel={() => setShowMap(false)}
                    />
                  </div>
                )}
              </div>

              <div className="pt-2 flex gap-3">
                <button type="button" onClick={() => setIsOpen(false)} className="btn-secondary flex-1">
                  Cancel
                </button>
                <button type="submit" disabled={isPending} className="btn-primary flex-1">
                  {isPending ? "Saving…" : existing ? "Save Changes" : "Create Zone"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
