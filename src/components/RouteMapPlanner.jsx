import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Download, MapPin, Plus, Search, X } from 'lucide-react';
import { MapContainer, Marker, Polyline, Polygon, TileLayer, Popup, Tooltip, useMap } from 'react-leaflet';
import { divIcon } from 'leaflet';
import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';
import 'leaflet/dist/leaflet.css';

import { fetchRoute, searchPlaces } from '../services/mapService';

const ROUTE_MAP_SNAPSHOT_KEY = 'route_map_saved_snapshot_v1';

const SRI_LANKA_CENTER = [7.8731, 80.7718];
const SRI_LANKA_BOUNDS = {
  minLat: 5.8,
  maxLat: 10.0,
  minLng: 79.4,
  maxLng: 82.1,
};

const INDIA_MASK = [
  [30.0, 50.0],
  [30.0, 80.35], 
  [10.4, 80.15], 
  [10.1, 80.05], 
  [9.6, 79.72], 
  [9.4, 79.54], // Ensure Dhanushkodi / Rameshwaram is fully covered
  [9.0, 79.42], 
  [8.0, 79.1],  
  [-10.0, 79.1],
  [-10.0, 50.0],
];

const redMarkerIcon = divIcon({
  className: 'route-marker-pin',
  html: '<span class="route-marker-core"></span>',
  iconSize: [20, 20],
  iconAnchor: [10, 10],
});

const normalizePlan = (plan) => ({
  enabled: false,
  attachToFinalPdf: false,
  stops: [],
  routeCoords: [],
  mapSnapshot: '',
  mapCenter: SRI_LANKA_CENTER,
  mapZoom: 7,
  ...(plan || {}),
});

export const hasRenderableRouteMapPlan = (plan) => {
  const safe = normalizePlan(plan);
  return safe.enabled && Array.isArray(safe.stops) && safe.stops.length >= 2;
};

const gatherPoints = (plan) => {
  const safe = normalizePlan(plan);
  const stopPoints = safe.stops.map((s) => ({ lat: Number(s.lat), lng: Number(s.lng) }));
  const routePoints = Array.isArray(safe.routeCoords)
    ? safe.routeCoords.map((p) => ({ lat: Number(p.lat), lng: Number(p.lng) }))
    : [];
  return [...routePoints, ...stopPoints].filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
};

const toSriLankaCanvasPoint = (point, width, height, padding = 28) => {
  const lngSpan = SRI_LANKA_BOUNDS.maxLng - SRI_LANKA_BOUNDS.minLng;
  const latSpan = SRI_LANKA_BOUNDS.maxLat - SRI_LANKA_BOUNDS.minLat;

  const x = padding + ((point.lng - SRI_LANKA_BOUNDS.minLng) / lngSpan) * (width - padding * 2);
  const y = height - padding - ((point.lat - SRI_LANKA_BOUNDS.minLat) / latSpan) * (height - padding * 2);
  return { x, y };
};

const FitSriLankaBounds = () => {
  const map = useMap();

  useEffect(() => {
    map.fitBounds([
      [SRI_LANKA_BOUNDS.minLat, SRI_LANKA_BOUNDS.minLng],
      [SRI_LANKA_BOUNDS.maxLat, SRI_LANKA_BOUNDS.maxLng],
    ], { padding: [20, 20] });
  }, [map]);

  return null;
};

const TrackMapView = ({ onViewChange, onMapReady }) => {
  const map = useMap();

  useEffect(() => {
    if (typeof onMapReady === 'function') onMapReady(map);
    const report = () => {
      if (typeof onViewChange !== 'function') return;
      const c = map.getCenter();
      onViewChange({
        center: [c.lat, c.lng],
        zoom: map.getZoom(),
      });
    };
    map.on('moveend', report);
    map.on('zoomend', report);
    report();
    return () => {
      map.off('moveend', report);
      map.off('zoomend', report);
    };
  }, [map, onViewChange, onMapReady]);

  return null;
};

export const RouteMapPdfPage = ({ plan }) => {
  const safe = normalizePlan(plan);
  if (safe.mapSnapshot) {
    return (
      <div className="pdf-page route-map-pdf-page" style={{ width: '210mm', minHeight: '297mm', background: '#fff', padding: '16mm 14mm 12mm' }}>
        <div style={{ border: '1px solid #e2e8f0', borderRadius: '12px', padding: '14px' }}>
          <h2 style={{ margin: 0, color: '#0f172a', fontSize: '1.25rem' }}>Sri Lanka Route Map</h2>
          <p style={{ margin: '8px 0 14px', color: '#475569', fontSize: '0.9rem' }}>
            Captured map view with selected locations and combined route.
          </p>
          <div style={{ borderRadius: '10px', overflow: 'hidden', border: '1px solid #dbeafe' }}>
            <img src={safe.mapSnapshot} alt="Sri Lanka route map snapshot" style={{ width: '100%', display: 'block' }} />
          </div>
        </div>
      </div>
    );
  }

  const routePoints = Array.isArray(safe.routeCoords)
    ? safe.routeCoords.map((p) => ({ lat: Number(p.lat), lng: Number(p.lng) })).filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng))
    : [];
  const stopPoints = safe.stops
    .map((s) => ({ ...s, lat: Number(s.lat), lng: Number(s.lng) }))
    .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));

  const width = 760;
  const height = 420;
  const routeSvg = routePoints.map((p) => toSriLankaCanvasPoint(p, width, height));
  const stopSvg = stopPoints.map((p) => toSriLankaCanvasPoint(p, width, height));

  return (
    <div className="pdf-page route-map-pdf-page" style={{ width: '210mm', minHeight: '297mm', background: '#fff', padding: '16mm 14mm 12mm' }}>
      <div style={{ border: '1px solid #e2e8f0', borderRadius: '12px', padding: '14px' }}>
        <h2 style={{ margin: 0, color: '#0f172a', fontSize: '1.25rem' }}>Sri Lanka Route Map</h2>
        <p style={{ margin: '8px 0 14px', color: '#475569', fontSize: '0.9rem' }}>
          Entire Sri Lanka view with red destination points and combined route line.
        </p>

        <div style={{ background: '#f8fafc', borderRadius: '10px', border: '1px solid #dbeafe', padding: '8px' }}>
          <svg viewBox={`0 0 ${width} ${height}`} width="100%" height="340" role="img" aria-label="Sri Lanka route map">
            <rect x="0" y="0" width={width} height={height} fill="#f8fafc" />

            <path
              d="M488 36 C530 62, 556 108, 552 156 C548 198, 520 240, 502 272 C486 302, 458 340, 425 372 C390 406, 346 404, 312 380 C276 354, 254 322, 230 286 C208 254, 190 220, 196 178 C202 138, 224 104, 250 78 C280 48, 320 28, 362 26 C408 24, 454 26, 488 36 Z"
              fill="#e2f2df"
              stroke="#7ca982"
              strokeWidth="3"
              opacity="0.92"
            />

            {routeSvg.length > 1 && (
              <polyline
                points={routeSvg.map((p) => `${p.x},${p.y}`).join(' ')}
                fill="none"
                stroke="#dc2626"
                strokeWidth="5"
                strokeLinecap="round"
                strokeLinejoin="round"
                opacity="0.95"
              />
            )}

            {stopSvg.map((p, idx) => (
              <g key={`stop-${idx}`}>
                <circle cx={p.x} cy={p.y} r="8" fill="#dc2626" stroke="#fff" strokeWidth="3" />
                <text x={p.x + 10} y={p.y - 10} fill="#0f172a" fontSize="13" fontWeight="700">{idx + 1}</text>
              </g>
            ))}
          </svg>
        </div>

        <div style={{ marginTop: '12px', borderTop: '1px solid #e2e8f0', paddingTop: '10px' }}>
          <h3 style={{ margin: '0 0 8px', color: '#1e293b', fontSize: '0.95rem' }}>Stops</h3>
          <div style={{ display: 'grid', gap: '6px' }}>
            {stopPoints.map((stop, idx) => (
              <div key={`${stop.id || stop.name}-${idx}`} style={{ fontSize: '0.85rem', color: '#334155' }}>
                {idx + 1}. {stop.shortName || stop.name}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

function RouteMapPlanner({ plan, onPlanChange }) {
  const safePlan = useMemo(() => normalizePlan(plan), [plan]);
  const [showMapView, setShowMapView] = useState(false);
  const [showPdfPreview, setShowPdfPreview] = useState(false);
  const [showMapSnapshotPreview, setShowMapSnapshotPreview] = useState(false);
  const [previewSnapshot, setPreviewSnapshot] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isRouting, setIsRouting] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [isSavingScreenshot, setIsSavingScreenshot] = useState(false);
  const [isScreenshotSaved, setIsScreenshotSaved] = useState(false);
  const [errorText, setErrorText] = useState('');
  const mapViewportRef = useRef(null);
  const mapViewSyncTimerRef = useRef(null);
  const lastSavedSnapshotRef = useRef('');
  const leafletMapRef = useRef(null);

  useEffect(() => {
    if (!safePlan.enabled) {
      setShowMapView(false);
    }
  }, [safePlan.enabled]);

  useEffect(() => {
    if (safePlan.mapSnapshot) {
      lastSavedSnapshotRef.current = safePlan.mapSnapshot;
      setPreviewSnapshot(safePlan.mapSnapshot);
      setIsScreenshotSaved(true);
      try {
        localStorage.setItem(ROUTE_MAP_SNAPSHOT_KEY, safePlan.mapSnapshot);
      } catch (_err) {
        // Ignore storage quota or privacy-mode errors.
      }
      return;
    }

    try {
      const stored = localStorage.getItem(ROUTE_MAP_SNAPSHOT_KEY) || '';
      if (stored) {
        lastSavedSnapshotRef.current = stored;
        setPreviewSnapshot(stored);
        setIsScreenshotSaved(true);
      }
    } catch (_err) {
      // Ignore localStorage read errors.
    }
  }, [safePlan.mapSnapshot]);

  const pushPlan = (planPatch) => {
    if (typeof onPlanChange === 'function') {
      onPlanChange((prev) => ({
        ...normalizePlan(prev),
        ...(planPatch || {}),
        updatedAt: new Date().toISOString(),
      }));
    }
  };

  const recomputeRoute = async (nextStops) => {
    if (nextStops.length < 2) {
      pushPlan({ stops: nextStops, routeCoords: [], mapSnapshot: '' });
      setIsScreenshotSaved(false);
      return;
    }

    setIsRouting(true);
    setErrorText('');
    try {
      const routeCoords = await fetchRoute(nextStops);
      pushPlan({ stops: nextStops, routeCoords, mapSnapshot: '' });
      setIsScreenshotSaved(false);
    } catch (_err) {
      pushPlan({ stops: nextStops, routeCoords: [], mapSnapshot: '' });
      setIsScreenshotSaved(false);
      setErrorText('Route service not reachable. Stops are saved, but route line is unavailable right now.');
    } finally {
      setIsRouting(false);
    }
  };

  const onSearch = async () => {
    const q = searchTerm.trim();
    if (!q) return;
    setIsSearching(true);
    setErrorText('');
    try {
      const results = await searchPlaces(q, 8);
      setSearchResults(results);
      if (results.length === 0) {
        setErrorText('No places found for that search term.');
      }
    } catch (_err) {
      setErrorText('Could not search places right now.');
    } finally {
      setIsSearching(false);
    }
  };

  const addStop = async (place) => {
    const exists = safePlan.stops.some((s) => Math.abs(Number(s.lat) - Number(place.lat)) < 0.00001 && Math.abs(Number(s.lng) - Number(place.lng)) < 0.00001);
    if (exists) return;
    const nextStops = [...safePlan.stops, place];
    await recomputeRoute(nextStops);
  };

  const removeStop = async (index) => {
    const nextStops = safePlan.stops.filter((_, idx) => idx !== index);
    await recomputeRoute(nextStops);
  };

  const moveStop = async (index, direction) => {
    const nextIdx = index + direction;
    if (nextIdx < 0 || nextIdx >= safePlan.stops.length) return;

    const nextStops = [...safePlan.stops];
    const tmp = nextStops[index];
    nextStops[index] = nextStops[nextIdx];
    nextStops[nextIdx] = tmp;
    await recomputeRoute(nextStops);
  };

  const toggleEnabled = (checked) => {
    if (!checked) {
      pushPlan({ enabled: false, attachToFinalPdf: false, stops: [], routeCoords: [], mapSnapshot: '' });
      setIsScreenshotSaved(false);
      return;
    }
    pushPlan({ enabled: true });
  };

  const toggleAttachToFinal = (checked) => {
    pushPlan({ attachToFinalPdf: checked });
  };

  const waitForPaint = async () => {
    await new Promise((resolve) => requestAnimationFrame(resolve));
    await new Promise((resolve) => setTimeout(resolve, 220));
  };

  const waitForMapSettle = async (map) => {
    if (!map) return;
    await new Promise((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        resolve();
      };
      map.once('moveend', finish);
      map.once('zoomend', finish);
      setTimeout(finish, 450);
    });
    await new Promise((resolve) => setTimeout(resolve, 120));
  };

  const waitForTilesToLoad = async (container, timeoutMs = 3000) => {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const tiles = Array.from(container?.querySelectorAll?.('.leaflet-tile') || []);
      if (tiles.length === 0) {
        await new Promise((resolve) => setTimeout(resolve, 120));
        continue;
      }
      const allLoaded = tiles.every((tile) => tile.complete && tile.naturalWidth > 0);
      if (allLoaded) {
        await new Promise((resolve) => setTimeout(resolve, 120));
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 120));
    }
  };

  const captureMapSnapshot = async () => {
    const map = leafletMapRef.current;
    if (!map) return '';

    const wrapper = mapViewportRef.current;
    const captureTarget = wrapper?.querySelector?.('.leaflet-container') || wrapper;
    if (!captureTarget || !wrapper) return '';

    // Save original styles to restore later
    const originalStyles = {
      width: wrapper.style.width,
      height: wrapper.style.height,
      position: wrapper.style.position,
      top: wrapper.style.top,
      left: wrapper.style.left,
      zIndex: wrapper.style.zIndex,
      flex: wrapper.style.flex,
    };

    // Temporarily force 720x1018 portrait layout (exact A4 aspect ratio) to tightly fit SL
    // and hide India off the edges, floating above everything to avoid layout bugs.
    wrapper.style.position = 'fixed';
    wrapper.style.top = '0px';
    wrapper.style.left = '0px';
    wrapper.style.width = '720px';
    wrapper.style.height = '1018px';
    wrapper.style.zIndex = '99999';
    wrapper.style.flex = 'none';
    
    map.invalidateSize();

    if (typeof map.fitBounds === 'function') {
      map.fitBounds([
        [SRI_LANKA_BOUNDS.minLat, SRI_LANKA_BOUNDS.minLng + 0.25], // Shift bound center east to crop India out of left frame edge
        [SRI_LANKA_BOUNDS.maxLat, SRI_LANKA_BOUNDS.maxLng + 0.25],
      ], { padding: [10, 10], animate: false });
      await waitForMapSettle(map);
    }
    
    // Quick wait for visuals
    await new Promise((resolve) => setTimeout(resolve, 300));

    // Fix translation bug that causes html2canvas to offset items
    const elementsWithTransform = captureTarget.querySelectorAll('*');
    const originalTransforms = [];
    elementsWithTransform.forEach(el => {
      const transform = el.style.transform;
      if (transform && transform.includes('translate3d')) {
        originalTransforms.push({ el, transform });
        el.style.transform = transform.replace(/translate3d\(([^,]+),\s*([^,]+),\s*[^)]+\)/g, 'translate($1, $2)');
      }
    });

    const prevScrollY = window.scrollY;
    const prevScrollX = window.scrollX;
    window.scrollTo(0, 0);

    let canvas;
    try {
      canvas = await html2canvas(captureTarget, {
        width: 720,
        height: 1018,
        windowWidth: 720,
        windowHeight: 1018,
        scale: 2,
        useCORS: true,
        allowTaint: false,
        logging: false,
        scrollX: 0,
        scrollY: 0,
        backgroundColor: '#d4dadc', // Exact Carto tile sea background hex
        ignoreElements: (el) => {
          const cls = (el && el.className) ? String(el.className) : '';
          return cls.includes('leaflet-control') || cls.includes('leaflet-popup');
        },
      });
    } finally {
      // Restore layout and sizing
      Object.assign(wrapper.style, originalStyles);
      map.invalidateSize();
      window.scrollTo(prevScrollX, prevScrollY);
      originalTransforms.forEach(({ el, transform }) => {
        el.style.transform = transform;
      });
    }

    return canvas.toDataURL('image/png');
  };

  const saveMapScreenshot = async () => {
    setIsSavingScreenshot(true);
    setErrorText('');
    try {
      const snapshot = await captureMapSnapshot();
      if (snapshot) {
        lastSavedSnapshotRef.current = snapshot;
        try {
          localStorage.setItem(ROUTE_MAP_SNAPSHOT_KEY, snapshot);
        } catch (_err) {
          // Ignore localStorage errors.
        }
        pushPlan({ mapSnapshot: snapshot });
        setPreviewSnapshot(snapshot);
        setIsScreenshotSaved(true);
      } else {
        setErrorText('Could not capture Sri Lanka Map View screenshot. Keep map view open and try again.');
      }
    } catch (_err) {
      setErrorText('Could not save screenshot. Please try again.');
    } finally {
      setIsSavingScreenshot(false);
    }
  };

  const previewSnapshotInsideMapView = async () => {
    setErrorText('');
    let snapshot = lastSavedSnapshotRef.current || safePlan.mapSnapshot || previewSnapshot || '';
    if (!snapshot) {
      try {
        snapshot = localStorage.getItem(ROUTE_MAP_SNAPSHOT_KEY) || '';
      } catch (_err) {
        snapshot = '';
      }
    }
    if (!snapshot) {
      setErrorText('Save screenshot first, then preview.');
      return;
    }
    setPreviewSnapshot(snapshot);
    setShowMapSnapshotPreview(true);
  };

  useEffect(() => {
    return () => {
      if (mapViewSyncTimerRef.current) clearTimeout(mapViewSyncTimerRef.current);
    };
  }, []);

  const handleDownloadMapPdf = async () => {
    if (!hasRenderableRouteMapPlan(safePlan)) return;

    setIsDownloading(true);
    setErrorText('');
    try {
      let snapshot = lastSavedSnapshotRef.current || safePlan.mapSnapshot || previewSnapshot || '';
      if (!snapshot) {
        try {
          snapshot = localStorage.getItem(ROUTE_MAP_SNAPSHOT_KEY) || '';
        } catch (_err) {
          snapshot = '';
        }
      }
      if (!snapshot) {
        setErrorText('Save screenshot first, then download PDF.');
        setIsDownloading(false);
        return;
      }
      setPreviewSnapshot(snapshot);

      const pdf = new jsPDF('p', 'mm', 'a4');
      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = pdf.internal.pageSize.getHeight();
      const marginX = 8;
      const marginY = 8;
      const imgType = snapshot.startsWith('data:image/png') ? 'PNG' : 'JPEG';
      const imageSize = await new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve({ width: img.naturalWidth || img.width, height: img.naturalHeight || img.height });
        img.onerror = () => reject(new Error('Image load failed'));
        img.src = snapshot;
      });

      const maxWidth = pdfWidth - marginX * 2;
      const maxHeight = pdfHeight - marginY * 2;
      const ratio = Math.min(maxWidth / imageSize.width, maxHeight / imageSize.height);
      const drawWidth = imageSize.width * ratio;
      const drawHeight = imageSize.height * ratio;
      const drawX = (pdfWidth - drawWidth) / 2;
      const drawY = (pdfHeight - drawHeight) / 2;
      pdf.addImage(snapshot, imgType, drawX, drawY, drawWidth, drawHeight);

      const dateStr = new Date().toISOString().slice(0, 10);
      pdf.save(`Invel-Sri-Lanka-Route-Map-${dateStr}.pdf`);
    } catch (_err) {
      setErrorText('Could not generate map PDF right now.');
    } finally {
      setIsDownloading(false);
    }
  };

  const closeMapView = () => {
    setShowMapView(false);
  };

  const handlePreviewMapPdf = async () => {
    setErrorText('');
    if (!hasRenderableRouteMapPlan(safePlan)) return;

    const snapshot = safePlan.mapSnapshot || '';

    if (!snapshot) {
      setErrorText('Open Map View and click Make Screenshot & Save first.');
      return;
    }

    setPreviewSnapshot(snapshot);
    setShowPdfPreview(true);
  };

  const routePositions = Array.isArray(safePlan.routeCoords)
    ? safePlan.routeCoords.map((p) => [p.lat, p.lng])
    : [];

  return (
    <div className="route-map-planner-card" style={{ marginTop: '25px', padding: '22px', background: 'white', borderRadius: '16px', border: '1px solid #e2e8f0', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.05)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '16px', alignItems: 'center', flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ fontSize: '1.2rem', color: 'var(--primary)', margin: 0 }}>Sri Lanka Map Destination Planner</h2>
          <p style={{ margin: '6px 0 0', color: '#64748b', fontSize: '0.86rem' }}>Single planner for whole itinerary route.</p>
        </div>

        <label style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', cursor: 'pointer', padding: '8px 12px', border: '1px solid #e2e8f0', borderRadius: '10px', background: '#f8fafc', marginBottom: 0, textTransform: 'none', letterSpacing: 0 }}>
          <input
            type="checkbox"
            checked={safePlan.enabled}
            onChange={(e) => toggleEnabled(e.target.checked)}
          />
          <span style={{ fontWeight: 700, fontSize: '0.82rem', color: '#334155' }}>Mark destinations using map</span>
          {safePlan.enabled && <Check size={16} color="#16a34a" />}
        </label>
      </div>

      {safePlan.enabled && (
        <>
          <div style={{ marginTop: '14px', display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
            <button className="btn btn-primary" style={{ width: 'auto', marginTop: 0, padding: '10px 14px' }} onClick={() => setShowMapView(true)}>
              <MapPin size={16} /> Open Map View
            </button>
            <button
              className="btn btn-outline"
              style={{ width: 'auto', marginTop: 0, padding: '10px 14px' }}
              onClick={handleDownloadMapPdf}
              disabled={!hasRenderableRouteMapPlan(safePlan) || isDownloading}
            >
              {isDownloading ? <><div className="spinner" /> Generating...</> : <><Download size={16} /> Download Route Map PDF</>}
            </button>
          </div>

          <label style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', marginTop: '12px', marginBottom: 0, textTransform: 'none', letterSpacing: 0 }}>
            <input
              type="checkbox"
              checked={safePlan.attachToFinalPdf}
              disabled={!hasRenderableRouteMapPlan(safePlan) || !safePlan.mapSnapshot}
              onChange={(e) => toggleAttachToFinal(e.target.checked)}
            />
            <span style={{ fontSize: '0.82rem', fontWeight: 700, color: '#334155' }}>Attach this route map to final itinerary PDF</span>
          </label>

          {errorText && <p style={{ margin: '10px 0 0', color: '#b91c1c', fontSize: '0.8rem' }}>{errorText}</p>}

          <div style={{ marginTop: '12px', fontSize: '0.8rem', color: '#475569' }}>
            Stops selected: <strong>{safePlan.stops.length}</strong>{' '}
            {safePlan.stops.length >= 2 && <span>- Route ready for PDF</span>}
          </div>
          {safePlan.mapSnapshot ? (
            <div style={{ marginTop: '6px', fontSize: '0.78rem', color: '#166534' }}>Snapshot ready for final PDF.</div>
          ) : (
            <div style={{ marginTop: '6px', fontSize: '0.78rem', color: '#92400e' }}>Open map view and click Make Screenshot & Save.</div>
          )}
        </>
      )}

      {showMapView && safePlan.enabled && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ maxWidth: '1150px', width: '95vw', height: '88vh', maxHeight: '88vh', display: 'flex', flexDirection: 'column' }}>
            <button className="close-btn" onClick={closeMapView}>
              <X size={24} />
            </button>

            <div style={{ padding: '16px 20px 10px', borderBottom: '1px solid #e2e8f0' }}>
              <h2 style={{ margin: 0, fontSize: '1.2rem', color: 'var(--primary)' }}>Sri Lanka Map View</h2>
              <p style={{ margin: '6px 0 0', color: '#64748b', fontSize: '0.85rem' }}>Search places and build route in the order you want to visit.</p>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr', gap: '14px', flex: 1, minHeight: 0, padding: '14px' }}>
              <div style={{ border: '1px solid #e2e8f0', borderRadius: '12px', padding: '12px', overflowY: 'auto', background: '#fff' }}>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <input
                    type="text"
                    className="modern-input"
                    placeholder="Search destination"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') onSearch();
                    }}
                    style={{ marginTop: 0 }}
                  />
                  <button className="btn btn-primary" style={{ width: 'auto', marginTop: 0, padding: '10px 12px' }} onClick={onSearch}>
                    <Search size={16} />
                  </button>
                </div>

                {isSearching && <p style={{ fontSize: '0.8rem', color: '#475569', marginTop: '10px' }}>Searching...</p>}

                <div style={{ marginTop: '12px' }}>
                  <div style={{ fontSize: '0.76rem', fontWeight: 700, color: '#334155', marginBottom: '6px', textTransform: 'uppercase' }}>Search Results</div>
                  <div style={{ display: 'grid', gap: '8px' }}>
                    {searchResults.map((res) => (
                      <button
                        key={res.id}
                        type="button"
                        onClick={() => addStop(res)}
                        className="route-result-btn"
                        style={{ textAlign: 'left', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '8px 10px', background: '#f8fafc', cursor: 'pointer' }}
                      >
                        <div style={{ fontSize: '0.82rem', fontWeight: 700, color: '#0f172a' }}>{res.shortName}</div>
                        <div style={{ fontSize: '0.72rem', color: '#64748b', marginTop: '2px' }}>{res.name}</div>
                      </button>
                    ))}
                  </div>
                </div>

                <div style={{ marginTop: '14px', paddingTop: '12px', borderTop: '1px solid #e2e8f0' }}>
                  <div style={{ fontSize: '0.76rem', fontWeight: 700, color: '#334155', marginBottom: '8px', textTransform: 'uppercase' }}>Selected Stops</div>
                  <div style={{ display: 'grid', gap: '8px' }}>
                    {safePlan.stops.map((stop, idx) => (
                      <div key={`${stop.id || stop.name}-${idx}`} style={{ border: '1px solid #e2e8f0', borderRadius: '9px', padding: '8px', background: '#fff' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
                          <span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#1e293b' }}>{idx + 1}. {stop.shortName || stop.name}</span>
                          <div style={{ display: 'flex', gap: '6px' }}>
                            <button className="btn btn-outline btn-sm" style={{ width: 'auto', marginTop: 0, padding: '4px 8px' }} onClick={() => moveStop(idx, -1)} disabled={idx === 0}>Up</button>
                            <button className="btn btn-outline btn-sm" style={{ width: 'auto', marginTop: 0, padding: '4px 8px' }} onClick={() => moveStop(idx, 1)} disabled={idx === safePlan.stops.length - 1}>Down</button>
                            <button className="btn btn-outline btn-sm" style={{ width: 'auto', marginTop: 0, padding: '4px 8px' }} onClick={() => removeStop(idx)}>
                              <X size={12} />
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}
                    {safePlan.stops.length === 0 && <p style={{ margin: 0, fontSize: '0.78rem', color: '#64748b' }}>No stops selected yet.</p>}
                  </div>
                </div>

                <div style={{ marginTop: '12px', fontSize: '0.78rem', color: '#475569' }}>
                  {isRouting ? 'Updating route line...' : `${safePlan.stops.length} stop(s) selected.`}
                </div>
              </div>

              <div id="route-map-capture" ref={mapViewportRef} style={{ border: '1px solid #e2e8f0', borderRadius: '12px', overflow: 'hidden', background: '#d4dadc' }}>
                <MapContainer
                  center={safePlan.mapCenter || SRI_LANKA_CENTER}
                  zoom={safePlan.mapZoom || 7}
                  minZoom={6}
                  preferCanvas={true}
                  style={{ width: '100%', height: '100%', background: '#d4dadc' }}
                  maxBounds={[
                    [SRI_LANKA_BOUNDS.minLat - 1, SRI_LANKA_BOUNDS.minLng - 1],
                    [SRI_LANKA_BOUNDS.maxLat + 1, SRI_LANKA_BOUNDS.maxLng + 1],
                  ]}
                  maxBoundsViscosity={1.0}
                >
                  <TileLayer
                    attribution='&copy; OpenStreetMap contributors &copy; CARTO'
                    url='https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png'
                    crossOrigin="anonymous"
                    noWrap
                    bounds={[
                      [SRI_LANKA_BOUNDS.minLat, SRI_LANKA_BOUNDS.minLng],
                      [SRI_LANKA_BOUNDS.maxLat, SRI_LANKA_BOUNDS.maxLng],
                    ]}
                  />

                  {/* Obscure India completely blending into Carto map sea color */}
                  <Polygon 
                    positions={INDIA_MASK} 
                    pathOptions={{ fillColor: '#d4dadc', color: '#d4dadc', fillOpacity: 1, opacity: 1, weight: 2 }} 
                  />

                  <FitSriLankaBounds />
                  <TrackMapView
                    onMapReady={(map) => {
                      leafletMapRef.current = map;
                    }}
                    onViewChange={({ center, zoom }) => {
                      if (mapViewSyncTimerRef.current) clearTimeout(mapViewSyncTimerRef.current);
                      mapViewSyncTimerRef.current = setTimeout(async () => {
                        const centerChanged = !safePlan.mapCenter
                          || Math.abs((safePlan.mapCenter[0] || 0) - center[0]) > 0.00001
                          || Math.abs((safePlan.mapCenter[1] || 0) - center[1]) > 0.00001;
                        const zoomChanged = Number(safePlan.mapZoom || 0) !== Number(zoom || 0);

                        if (centerChanged || zoomChanged) {
                          // Keep last saved snapshot for PDF consistency; only mark UI state as needing re-save.
                          pushPlan({ mapCenter: center, mapZoom: zoom });
                          setIsScreenshotSaved(false);
                        }
                      }, 450);
                    }}
                  />

                  {safePlan.stops.map((stop, idx) => (
                    <Marker key={`${stop.id || stop.name}-${idx}`} position={[stop.lat, stop.lng]} icon={redMarkerIcon}>
                      <Tooltip className="transparent-tooltip" direction="right" offset={[12, 0]} opacity={1} permanent>
                        <span style={{ fontSize: '13px', fontWeight: 'bold', color: '#dc2626', textShadow: '2px 2px 4px #ffffff, -2px -2px 4px #ffffff, 2px -2px 4px #ffffff, -2px 2px 4px #ffffff', whiteSpace: 'nowrap' }}>
                          {stop.shortName || stop.name}
                        </span>
                      </Tooltip>
                      <Popup>
                        <strong>{idx + 1}. {stop.shortName || stop.name}</strong>
                      </Popup>
                    </Marker>
                  ))}

                  {routePositions.length > 1 && <Polyline positions={routePositions} pathOptions={{ color: '#dc2626', weight: 5, opacity: 0.9 }} />}
                </MapContainer>
              </div>
            </div>

            <div style={{ padding: '12px 16px', borderTop: '1px solid #e2e8f0', background: '#f8fafc', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '0.8rem', color: '#475569' }}>Red pins show destinations. Red line highlights combined route.</span>
              <div style={{ display: 'flex', gap: '10px' }}>
                <button className="btn btn-outline" style={{ width: 'auto', marginTop: 0, padding: '10px 14px' }} onClick={saveMapScreenshot} disabled={isSavingScreenshot}>
                  {isSavingScreenshot ? 'Saving...' : (
                    <>
                      Make Screenshot & Save {isScreenshotSaved && <Check size={14} color="#16a34a" />}
                    </>
                  )}
                </button>
                <button
                  className="btn btn-outline"
                  style={{ width: 'auto', marginTop: 0, padding: '10px 14px' }}
                  onClick={handlePreviewMapPdf}
                  disabled={!hasRenderableRouteMapPlan(safePlan)}
                >
                  Preview Route Map PDF
                </button>
                <button className="btn btn-primary" style={{ width: 'auto', marginTop: 0, padding: '10px 14px' }} onClick={closeMapView}>
                  <Plus size={14} /> Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showMapSnapshotPreview && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ maxWidth: '900px', width: '92vw', maxHeight: '88vh', display: 'flex', flexDirection: 'column' }}>
            <button className="close-btn" onClick={() => setShowMapSnapshotPreview(false)}>
              <X size={24} />
            </button>
            <div style={{ padding: '14px 18px', borderBottom: '1px solid #e2e8f0' }}>
              <h2 style={{ margin: 0, fontSize: '1.05rem', color: 'var(--primary)' }}>Saved Screenshot Preview</h2>
              <p style={{ margin: '6px 0 0', color: '#64748b', fontSize: '0.84rem' }}>
                This image is what will be used for route map PDF generation.
              </p>
            </div>
            <div style={{ padding: '14px', overflow: 'hidden', background: '#f8fafc', flex: 1, display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '0' }}>
              {previewSnapshot ? (
                <img src={previewSnapshot} alt="Saved map screenshot preview" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', display: 'block', borderRadius: '10px', border: '1px solid #e2e8f0', background: '#fff' }} />
              ) : (
                <div style={{ textAlign: 'center', color: '#64748b', fontSize: '0.9rem' }}>No screenshot available.</div>
              )}
            </div>
          </div>
        </div>
      )}

      {showPdfPreview && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ maxWidth: '920px', width: '94vw', height: '86vh', maxHeight: '86vh', display: 'flex', flexDirection: 'column' }}>
            <button className="close-btn" onClick={() => setShowPdfPreview(false)}>
              <X size={24} />
            </button>

            <div style={{ padding: '14px 18px', borderBottom: '1px solid #e2e8f0' }}>
              <h2 style={{ margin: 0, fontSize: '1.15rem', color: 'var(--primary)' }}>Route Map PDF Preview</h2>
              <p style={{ margin: '6px 0 0', color: '#64748b', fontSize: '0.84rem' }}>This is the same map page used for final attachment and map PDF download.</p>
            </div>

            <div style={{ flex: 1, overflow: 'hidden', background: '#f8fafc', padding: '14px', display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '0' }}>
              {previewSnapshot ? (
                <div style={{ maxWidth: '860px', height: '100%', width: '100%', display: 'flex', justifyContent: 'center', alignItems: 'center', background: '#fff', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '12px' }}>
                  <img src={previewSnapshot} alt="Route map snapshot preview" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', display: 'block', borderRadius: '8px' }} />
                </div>
              ) : (
                <div style={{ textAlign: 'center', color: '#64748b', fontSize: '0.9rem' }}>No snapshot available yet.</div>
              )}
            </div>

            <div style={{ padding: '12px 16px', borderTop: '1px solid #e2e8f0', background: '#f8fafc', display: 'flex', justifyContent: 'center' }}>
              <button className="btn btn-primary" style={{ width: '260px', marginTop: 0 }} onClick={handleDownloadMapPdf} disabled={isDownloading}>
                {isDownloading ? <><div className="spinner" /> Generating...</> : <><Download size={16} /> Download This Map PDF</>}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default RouteMapPlanner;
