
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { 
  Trash2, 
  Download, 
  Plus, 
  Navigation,
  Pencil,
  Hand,
  Check,
  Eraser,
  X,
  ArrowRightLeft,
  Undo2,
  Redo2,
  Upload,
  Scissors,
  GitMerge,
  MoveUpRight,
  Milestone,
  Loader2,
  WifiOff,
  Lock,
  Unlock,
  Activity,
  Map as MapIcon,
  Menu,
  Info,
  RefreshCw,
  Eye,
  EyeOff,
  Maximize2,
  Minimize2,
  Globe,
  Layers
} from 'lucide-react';
import { RouteSegment, Coordinate } from './types';
import { exportToGPX } from './utils/gpxExporter';
import { exportToKML } from './utils/kmlExporter';
import { parseGPX } from './utils/gpxParser';
import { parseKMZ } from './utils/kmzParser';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

const COLORS = [
  '#ff3333', '#33ff33', '#33ccff', '#ffff33', '#ff33ff', 
  '#ff9933', '#ffffff', '#a855f7', '#10b981', '#f43f5e', 
  '#06b6d4', '#eab308', '#ec4899', '#8b5cf6'
];

type InteractionMode = 'pan' | 'draw' | 'edit' | 'scissor' | 'merge' | 'delete' | 'eraser' | 'route' | 'extend' | 'reverse';

interface RoutingPart {
  from: Coordinate;
  to: Coordinate;
  path: Coordinate[];
  altIndex: number;
}

const getDistance = (p1: Coordinate, p2: Coordinate) => {
  const R = 6371;
  const dLat = (p2.lat - p1.lat) * Math.PI / 180;
  const dLon = (p2.lng - p1.lng) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(p1.lat * Math.PI / 180) * Math.cos(p2.lat * Math.PI / 180) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

const App: React.FC = () => {
  const [segments, setSegments] = useState<RouteSegment[]>([]);
  const [history, setHistory] = useState<RouteSegment[][]>([]);
  const [redoHistory, setRedoHistory] = useState<RouteSegment[][]>([]);
  const [activeSegmentId, setActiveSegmentId] = useState<string | null>(null);
  const [mergeSourceId, setMergeSourceId] = useState<string | null>(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(window.innerWidth > 768);
  const [interactionMode, setInteractionMode] = useState<InteractionMode>('pan');
  const [mapReady, setMapReady] = useState(false);
  const [isRoutingLoading, setIsRoutingLoading] = useState(false);
  const [isOffline, setIsOffline] = useState(!navigator.onLine);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);
  const [isSpacePressed, setIsSpacePressed] = useState(false);
  
  type BasemapId = 'esri-satellite' | 'google-hybrid' | 'google-satellite' | 'google-terrain' | 'opentopo' | 'osm';
  const [activeBasemap, setActiveBasemap] = useState<BasemapId>('esri-satellite');
  const [showLayerMenu, setShowLayerMenu] = useState(false);
  const [basemapNotice, setBasemapNotice] = useState<string | null>(null);
  const tileLayerRef = useRef<any>(null);
  const tileErrorCountRef = useRef<number>(0);
  
  const [routingParts, setRoutingParts] = useState<RoutingPart[]>([]);
  const [routingRedoParts, setRoutingRedoParts] = useState<RoutingPart[]>([]);

  const mapRef = useRef<any>(null);
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const polylineRefs = useRef<{ [key: string]: any[] }>({}); 
  const markerRefs = useRef<{ [key: string]: any[] }>({});
  const routingPolylineRef = useRef<any>(null);
  const routingMarkersRef = useRef<any[]>([]);
  const colorCounterRef = useRef<number>(0);

  const stateRef = useRef({ 
    interactionMode, 
    activeSegmentId, 
    segments, 
    routingParts, 
    routingRedoParts,
    isFullscreen,
    isSpacePressed
  });

  useEffect(() => {
    stateRef.current = { 
      interactionMode, 
      activeSegmentId, 
      segments, 
      routingParts, 
      routingRedoParts,
      isFullscreen,
      isSpacePressed
    };
  }, [interactionMode, activeSegmentId, segments, routingParts, routingRedoParts, isFullscreen, isSpacePressed]);

  const isDrawingRef = useRef(false);
  const currentPathPoints = useRef<Coordinate[]>([]);
  const tempPolylineRef = useRef<any>(null);
  const lastAddedPointRef = useRef<{x: number, y: number} | null>(null);
  const extensionTypeRef = useRef<'append' | 'prepend' | 'new'>('new');

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth <= 768);
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    window.addEventListener('resize', handleResize);
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    const handleOnline = () => setIsOffline(false);
    const handleOffline = () => setIsOffline(true);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('resize', handleResize);
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const toggleFullscreen = useCallback(async () => {
    try {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen();
      } else {
        if (document.exitFullscreen) {
          await document.exitFullscreen();
        }
      }
    } catch (err) {
      console.error("Error attempting to toggle full-screen mode:", err);
    }
  }, []);

  const getNextColor = useCallback(() => {
    const color = COLORS[colorCounterRef.current % COLORS.length];
    colorCounterRef.current += 1;
    return color;
  }, []);

  const pushToHistory = useCallback(() => {
    setHistory(prev => [...prev, JSON.parse(JSON.stringify(stateRef.current.segments))].slice(-50));
    setRedoHistory([]); 
  }, []);

  const handleUndo = useCallback(() => {
    const { interactionMode, routingParts } = stateRef.current;
    
    if (interactionMode === 'route') {
      if (routingParts.length === 0) return;
      const last = routingParts[routingParts.length - 1];
      setRoutingRedoParts(prev => [...prev, last]);
      setRoutingParts(prev => prev.slice(0, -1));
      return;
    }

    if (history.length === 0) return;
    const previous = history[history.length - 1];
    setRedoHistory(prev => [...prev, JSON.parse(JSON.stringify(stateRef.current.segments))]);
    setSegments(previous);
    setHistory(prev => prev.slice(0, -1));
  }, [history]);

  const handleRedo = useCallback(() => {
    const { interactionMode, routingRedoParts } = stateRef.current;

    if (interactionMode === 'route') {
      if (routingRedoParts.length === 0) return;
      const next = routingRedoParts[routingRedoParts.length - 1];
      setRoutingParts(prev => [...prev, next]);
      setRoutingRedoParts(prev => prev.slice(0, -1));
      return;
    }

    if (redoHistory.length === 0) return;
    const next = redoHistory[redoHistory.length - 1];
    setHistory(prev => [...prev, JSON.parse(JSON.stringify(stateRef.current.segments))]);
    setSegments(next);
    setRedoHistory(prev => prev.slice(0, -1));
  }, [redoHistory]);

  const deleteSegment = useCallback((id: string) => {
    pushToHistory();
    setSegments(prev => prev.filter(s => s.id !== id));
    if (stateRef.current.activeSegmentId === id) setActiveSegmentId(null);
  }, [pushToHistory]);

  const toggleVisibility = useCallback((id: string) => {
    setSegments(prev => prev.map(s => s.id === id ? { ...s, visible: !s.visible } : s));
  }, []);

  const reverseSegment = useCallback((id: string) => {
    pushToHistory();
    setSegments(prev => prev.map(s => s.id === id ? { ...s, points: [...s.points].reverse() } : s));
  }, [pushToHistory]);

  const finishRouting = useCallback(() => {
    const { routingParts } = stateRef.current;
    if (routingParts.length > 0) {
      const allPoints: Coordinate[] = [];
      routingParts.forEach((part, idx) => {
        if (idx === 0) allPoints.push(...part.path);
        else allPoints.push(...part.path.slice(1));
      });

      if (allPoints.length >= 2) {
        pushToHistory();
        const id = Math.random().toString(36).substr(2, 9);
        setSegments(prev => [...prev, {
          id,
          name: `Οδική Διαδρομή ${prev.length + 1}`,
          points: allPoints,
          color: getNextColor(),
          visible: true
        }]);
        setActiveSegmentId(id);
      }
    }
    setRoutingParts([]);
    setRoutingRedoParts([]);
    setInteractionMode('pan');
  }, [pushToHistory, getNextColor]);

  // Keyboard Event Handlers
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      
      const key = e.key.toLowerCase();

      // Spacebar for panning in draw mode
      if (e.code === 'Space' || e.keyCode === 32) {
        if (!isSpacePressed) {
          setIsSpacePressed(true);
          if (mapRef.current) mapRef.current.dragging.enable();
        }
        if (stateRef.current.interactionMode === 'draw' || stateRef.current.interactionMode === 'extend') {
           e.preventDefault();
        }
      }

      const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
      const cmdOrCtrl = isMac ? e.metaKey : e.ctrlKey;

      if (cmdOrCtrl && e.shiftKey && key === 'z') { e.preventDefault(); handleRedo(); } 
      else if (cmdOrCtrl && key === 'z') { e.preventDefault(); handleUndo(); }
      else if (key === 'delete' || key === 'backspace') {
        const { activeSegmentId } = stateRef.current;
        if (activeSegmentId) { e.preventDefault(); deleteSegment(activeSegmentId); }
      }
      
      // Shortcuts for Interaction Modes
      if (key === 'a') {
        e.preventDefault();
        setInteractionMode('pan');
      } else if (key === 'b') {
        e.preventDefault();
        setInteractionMode('scissor');
      } else if (key === 'c') {
        e.preventDefault();
        setMergeSourceId(null);
        setInteractionMode('merge');
      } else if (key === 'd') {
        e.preventDefault();
        setInteractionMode('draw');
      } else if (key === 'f') {
        e.preventDefault();
        toggleFullscreen();
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space' || e.keyCode === 32) {
        setIsSpacePressed(false);
        const { interactionMode } = stateRef.current;
        if (mapRef.current && (interactionMode === 'draw' || interactionMode === 'extend')) {
          mapRef.current.dragging.disable();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [handleUndo, handleRedo, deleteSegment, isSpacePressed, toggleFullscreen]);

  useEffect(() => {
    if (!mapRef.current) return;
    if (interactionMode === 'pan' || isSpacePressed) {
      mapRef.current.dragging.enable();
    } else if (interactionMode === 'draw' || interactionMode === 'extend') {
      mapRef.current.dragging.disable();
    } else {
      mapRef.current.dragging.enable();
    }
  }, [interactionMode, isSpacePressed, mapReady]);

  const fetchOSRMRoute = async (start: Coordinate, end: Coordinate, alternatives: boolean = false): Promise<any> => {
    if (isOffline) return { path: [start, end], routes: [[start, end]] };
    try {
      const response = await fetch(`https://router.project-osrm.org/route/v1/driving/${start.lng},${start.lat};${end.lng},${end.lat}?overview=full&geometries=geojson&alternatives=${alternatives}`);
      const data = await response.json();
      if (data.code !== 'Ok' || !data.routes || data.routes.length === 0) return { path: [start, end], routes: [[start, end]] };
      const allRoutes = data.routes.map((route: any) => 
        route.geometry.coordinates.map((coord: [number, number]) => ({ lat: coord[1], lng: coord[0] }))
      );
      return { path: allRoutes[0], routes: allRoutes };
    } catch (error) { 
      return { path: [start, end], routes: [[start, end]] }; 
    }
  };

  const handleMapClick = async (e: any) => {
    const { interactionMode, routingParts: currentParts } = stateRef.current;
    if (interactionMode !== 'route') return;
    
    const clickCoord = { lat: e.latlng.lat, lng: e.latlng.lng };
    const isAltKey = e.originalEvent.altKey;

    if (isAltKey && currentParts.length > 0) {
      let minPartIdx = -1;
      let minDistance = 0.1;
      currentParts.forEach((part, idx) => {
        part.path.forEach(pt => {
          const d = getDistance(pt, clickCoord);
          if (d < minDistance) {
            minDistance = d;
            minPartIdx = idx;
          }
        });
      });

      if (minPartIdx !== -1) {
        setIsRoutingLoading(true);
        const targetPart = currentParts[minPartIdx];
        const res = await fetchOSRMRoute(targetPart.from, targetPart.to, true);
        if (res.routes.length > 1) {
          const nextIdx = (targetPart.altIndex + 1) % res.routes.length;
          setRoutingParts(prev => {
            const newParts = [...prev];
            newParts[minPartIdx] = {
              ...targetPart,
              path: res.routes[nextIdx],
              altIndex: nextIdx
            };
            return newParts;
          });
        }
        setIsRoutingLoading(false);
        return;
      }
    }

    setIsRoutingLoading(true);
    if (currentParts.length === 0) {
      setRoutingParts([{ from: clickCoord, to: clickCoord, path: [clickCoord], altIndex: 0 }]);
      setRoutingRedoParts([]);
    } else {
      const lastPart = currentParts[currentParts.length - 1];
      const res = await fetchOSRMRoute(lastPart.to, clickCoord);
      setRoutingParts(prev => [...prev, {
        from: lastPart.to,
        to: clickCoord,
        path: res.path,
        altIndex: 0
      }]);
      setRoutingRedoParts([]);
    }
    setIsRoutingLoading(false);
  };

  const executeMerge = useCallback((idA: string, idB: string) => {
    pushToHistory();
    setSegments(prev => {
      const segA = prev.find(s => s.id === idA);
      const segB = prev.find(s => s.id === idB);
      if (!segA || !segB) return prev;
      const aS = segA.points[0]; const aE = segA.points[segA.points.length - 1];
      const bS = segB.points[0]; const bE = segB.points[segB.points.length - 1];
      const dists = [
        { d: getDistance(aE, bS), revA: false, revB: false },
        { d: getDistance(aE, bE), revA: false, revB: true },
        { d: getDistance(aS, bS), revA: true, revB: false },
        { d: getDistance(aS, bE), revA: true, revB: true }
      ];
      dists.sort((a, b) => a.d - b.d);
      const best = dists[0];
      let pointsA = best.revA ? [...segA.points].reverse() : [...segA.points];
      let pointsB = best.revB ? [...segB.points].reverse() : [...segB.points];
      const joinDist = getDistance(pointsA[pointsA.length - 1], pointsB[0]);
      const mergedPoints = joinDist < 0.005 ? [...pointsA, ...pointsB.slice(1)] : [...pointsA, ...pointsB];
      const newId = Math.random().toString(36).substr(2, 9);
      setActiveSegmentId(newId);
      return [ ...prev.filter(s => s.id !== idA && s.id !== idB), { ...segA, id: newId, points: mergedPoints, name: `${segA.name} + ${segB.name}`, color: getNextColor() } ];
    });
    setMergeSourceId(null);
    setInteractionMode('pan');
  }, [pushToHistory, getNextColor]);

  const handleSplit = useCallback((segmentId: string, latlng: any) => {
    pushToHistory();
    setSegments(prev => {
      const s = prev.find(r => r.id === segmentId);
      if (!s) return prev;
      const idx = findNearestPointIndex(s.points, latlng);
      if (idx <= 0 || idx >= s.points.length - 1) return prev;
      const p1 = s.points.slice(0, idx + 1); const p2 = s.points.slice(idx);
      return [ ...prev.filter(r => r.id !== segmentId), { ...s, id: Math.random().toString(36).substr(2, 9), points: p1, name: `${s.name} (A)`, color: getNextColor() }, { ...s, id: Math.random().toString(36).substr(2, 9), points: p2, name: `${s.name} (B)`, color: getNextColor() } ];
    });
  }, [pushToHistory, getNextColor]);

  const handleErase = useCallback((segmentId: string, latlng: any) => {
    pushToHistory();
    setSegments(prev => {
      const s = prev.find(r => r.id === segmentId);
      if (!s) return prev;
      const idx = findNearestPointIndex(s.points, latlng);
      if (idx === -1) return prev;
      const p1 = s.points.slice(0, idx); const p2 = s.points.slice(idx + 1);
      const newSegments = prev.filter(r => r.id !== segmentId);
      if (p1.length >= 2) newSegments.push({ ...s, id: Math.random().toString(36).substr(2, 9), points: p1, name: `${s.name} (A)`, color: getNextColor() });
      if (p2.length >= 2) newSegments.push({ ...s, id: Math.random().toString(36).substr(2, 9), points: p2, name: `${s.name} (B)`, color: getNextColor() });
      return newSegments;
    });
  }, [pushToHistory, getNextColor]);

  const findNearestPointIndex = (points: Coordinate[], latlng: any) => {
    let minDist = Infinity; let index = -1;
    points.forEach((p, i) => { const d = getDistance(p, { lat: latlng.lat, lng: latlng.lng }); if (d < minDist) { minDist = d; index = i; } });
    return index;
  };

  const getBasemapConfig = (basemap: BasemapId) => {
    switch (basemap) {
      case 'google-hybrid':
        return { 
          url: 'https://mt{s}.google.com/vt/lyrs=y&x={x}&y={y}&z={z}', 
          opts: { maxZoom: 20, subdomains: ['0', '1', '2', '3'], attribution: 'Google' } 
        };
      case 'google-satellite':
        return { 
          url: 'https://mt{s}.google.com/vt/lyrs=s&x={x}&y={y}&z={z}', 
          opts: { maxZoom: 20, subdomains: ['0', '1', '2', '3'], attribution: 'Google' } 
        };
      case 'google-terrain':
        return { 
          url: 'https://mt{s}.google.com/vt/lyrs=p&x={x}&y={y}&z={z}', 
          opts: { maxZoom: 20, subdomains: ['0', '1', '2', '3'], attribution: 'Google' } 
        };
      case 'esri-satellite':
        return { 
          url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', 
          opts: { maxZoom: 19, attribution: 'Esri World Imagery' } 
        };
      case 'opentopo':
        return { 
          url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', 
          opts: { maxZoom: 17, subdomains: ['a', 'b', 'c'], attribution: 'OpenTopoMap' } 
        };
      case 'osm':
      default:
        return { 
          url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', 
          opts: { maxZoom: 19, subdomains: ['a', 'b', 'c'], attribution: 'OpenStreetMap' } 
        };
    }
  };

  const createTileLayer = (basemap: BasemapId) => {
    const { url, opts } = getBasemapConfig(basemap);
    tileErrorCountRef.current = 0;
    const layer = L.tileLayer(url, opts);
    layer.on('tileerror', () => {
      tileErrorCountRef.current++;
      if (tileErrorCountRef.current >= 4 && (basemap === 'google-hybrid' || basemap === 'google-satellite')) {
        console.warn("Google satellite tiles blocked. Auto-switching to Esri World Satellite.");
        setActiveBasemap('esri-satellite');
        setBasemapNotice("Τα δορυφορικά πλακίδια Google δεν φορτώνουν στον περιηγητή. Έγινε αυτόματη εναλλαγή σε Esri World Satellite.");
        setTimeout(() => setBasemapNotice(null), 5000);
      }
    });
    return layer;
  };

  useEffect(() => {
    const container = mapContainerRef.current;
    if (!container || mapRef.current) return;

    if ((container as any)._leaflet_id) {
      delete (container as any)._leaflet_id;
    }
    container.innerHTML = '';

    const map = L.map(container, {
      zoomControl: false,
      attributionControl: false,
      zoomSnap: 0.1,
      inertia: true
    }).setView([37.9838, 23.7275], 13);

    L.control.zoom({ position: 'bottomright' }).addTo(map);

    const baseLayer = createTileLayer(activeBasemap).addTo(map);
    tileLayerRef.current = baseLayer;

    map.on('click', handleMapClick);

    // Ensure Leaflet calculates dimensions accurately
    const resizeObserver = new ResizeObserver(() => {
      if (map) {
        try { map.invalidateSize(); } catch (_) {}
      }
    });
    resizeObserver.observe(container);

    setTimeout(() => {
      try { map.invalidateSize(); } catch (_) {}
    }, 50);
    setTimeout(() => {
      try { map.invalidateSize(); } catch (_) {}
    }, 200);
    setTimeout(() => {
      try { map.invalidateSize(); } catch (_) {}
    }, 600);

    const startDrawing = (latlng: any, x: number, y: number) => {
      const { activeSegmentId, segments, interactionMode, isSpacePressed } = stateRef.current;
      if (isSpacePressed) return;
      const mouseP = map.latLngToContainerPoint(latlng);
      map.dragging.disable();
      
      extensionTypeRef.current = 'new'; let targetSegId = activeSegmentId;
      if (interactionMode === 'extend') {
        let found = false;
        for (const seg of segments) {
          if (seg.points.length === 0) continue;
          const sP = map.latLngToContainerPoint([seg.points[0].lat, seg.points[0].lng]);
          const eP = map.latLngToContainerPoint([seg.points[seg.points.length - 1].lat, seg.points[seg.points.length - 1].lng]);
          if (mouseP.distanceTo(sP) < 50) { extensionTypeRef.current = 'prepend'; targetSegId = seg.id; found = true; break; }
          else if (mouseP.distanceTo(eP) < 50) { extensionTypeRef.current = 'append'; targetSegId = seg.id; found = true; break; }
        }
        if (!found) { map.dragging.enable(); return; }
      }
      setActiveSegmentId(targetSegId); isDrawingRef.current = true;
      currentPathPoints.current = [{ lat: latlng.lat, lng: latlng.lng }]; lastAddedPointRef.current = { x, y };
      const activeColor = segments.find(s => s.id === targetSegId)?.color || COLORS[colorCounterRef.current % COLORS.length];
      tempPolylineRef.current = L.polyline([latlng], { color: activeColor, weight: 4, opacity: 0.9, lineCap: 'round', interactive: false }).addTo(map);
    };

    const onTouchStart = (e: TouchEvent) => {
      const { interactionMode, isSpacePressed } = stateRef.current;
      if (interactionMode !== 'draw' && interactionMode !== 'extend') return;
      if (e.touches.length > 1 || isSpacePressed) { map.dragging.enable(); isDrawingRef.current = false; return; }
      const touch = e.touches[0]; 
      const containerPoint = map.mouseEventToContainerPoint(touch as unknown as MouseEvent); 
      const latlng = map.containerPointToLatLng(containerPoint);
      startDrawing(latlng, touch.clientX, touch.clientY);
    };

    const onMouseDown = (e: MouseEvent) => {
      const { interactionMode, isSpacePressed } = stateRef.current;
      if (interactionMode !== 'draw' && interactionMode !== 'extend') return;
      if (e.button !== 0 || isSpacePressed) return;
      const latlng = map.mouseEventToLatLng(e);
      startDrawing(latlng, e.clientX, e.clientY);
    };

    const onMove = (e: MouseEvent | TouchEvent) => {
      if (!isDrawingRef.current || !map || !tempPolylineRef.current) return;
      if (e.cancelable) e.preventDefault();
      const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX; const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
      if (lastAddedPointRef.current) { const dx = clientX - lastAddedPointRef.current.x; const dy = clientY - lastAddedPointRef.current.y; if (Math.sqrt(dx*dx + dy*dy) < 8) return; }
      const mouseEvt = ('touches' in e ? e.touches[0] : e) as unknown as MouseEvent;
      const containerPoint = map.mouseEventToContainerPoint(mouseEvt);
      const latlng = map.containerPointToLatLng(containerPoint);
      if (latlng) { currentPathPoints.current.push({ lat: latlng.lat, lng: latlng.lng }); tempPolylineRef.current.addLatLng(latlng); lastAddedPointRef.current = { x: clientX, y: clientY }; }
    };

    const onEnd = () => {
      if (!isDrawingRef.current) {
        const { interactionMode, isSpacePressed } = stateRef.current;
        if (interactionMode === 'pan' || isSpacePressed) { map.dragging.enable(); }
        return;
      }
      isDrawingRef.current = false; const { activeSegmentId } = stateRef.current;
      if (currentPathPoints.current.length >= 2) {
        const recorded = [...currentPathPoints.current]; pushToHistory();
        setSegments(prev => {
          if (extensionTypeRef.current === 'append' && activeSegmentId) return prev.map(s => s.id === activeSegmentId ? { ...s, points: [...s.points, ...recorded] } : s);
          else if (extensionTypeRef.current === 'prepend' && activeSegmentId) return prev.map(s => s.id === activeSegmentId ? { ...s, points: [...recorded.reverse(), ...s.points] } : s);
          else { const nId = Math.random().toString(36).substr(2, 9); return [...prev, { id: nId, name: `Διαδρομή ${prev.length + 1}`, points: recorded, color: getNextColor(), visible: true }]; }
        });
      }
      if (tempPolylineRef.current) {
        try { tempPolylineRef.current.remove(); } catch (_) {}
        tempPolylineRef.current = null;
      }
      const { interactionMode, isSpacePressed: stillSpace } = stateRef.current;
      if (interactionMode === 'pan' || stillSpace) { map.dragging.enable(); } else { map.dragging.disable(); }
    };

    container.addEventListener('mousedown', onMouseDown);
    container.addEventListener('touchstart', onTouchStart, { passive: false });
    window.addEventListener('mousemove', onMove, { passive: false });
    window.addEventListener('touchmove', onMove, { passive: false });
    window.addEventListener('mouseup', onEnd);
    window.addEventListener('touchend', onEnd);
    
    mapRef.current = map;
    setMapReady(true);
    
    return () => {
      resizeObserver.disconnect();
      container.removeEventListener('mousedown', onMouseDown);
      container.removeEventListener('touchstart', onTouchStart);
      if (tempPolylineRef.current) {
        try { tempPolylineRef.current.remove(); } catch (_) {}
        tempPolylineRef.current = null;
      }
      if (tileLayerRef.current) {
        try { tileLayerRef.current.remove(); } catch (_) {}
        tileLayerRef.current = null;
      }
      try {
        map.remove();
      } catch (_) {}
      mapRef.current = null;
      setMapReady(false);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('mouseup', onEnd);
      window.removeEventListener('touchend', onEnd);
    };
  }, [pushToHistory, getNextColor]);

  useEffect(() => {
    if (mapRef.current) {
      setTimeout(() => {
        try { mapRef.current.invalidateSize(); } catch (_) {}
      }, 150);
      setTimeout(() => {
        try { mapRef.current.invalidateSize(); } catch (_) {}
      }, 350);
    }
  }, [isSidebarOpen, isFullscreen]);

  useEffect(() => {
    if (!mapRef.current || !mapReady) return;
    try {
      if (tileLayerRef.current) {
        tileLayerRef.current.remove();
        tileLayerRef.current = null;
      }
      if (mapRef.current && mapRef.current.getPane && mapRef.current.getPane('tilePane')) {
        tileLayerRef.current = createTileLayer(activeBasemap).addTo(mapRef.current);
      }
    } catch (err) {
      console.warn("Could not switch basemap:", err);
    }
  }, [activeBasemap, mapReady]);

  useEffect(() => {
    if (!mapRef.current || !mapReady) return;
    
    segments.forEach(segment => {
      const isActive = activeSegmentId === segment.id; 
      const isMergeSource = mergeSourceId === segment.id;
      
      if (polylineRefs.current[segment.id]) {
        polylineRefs.current[segment.id].forEach(l => { try { l.remove(); } catch (_) {} });
      }
      polylineRefs.current[segment.id] = [];
      if (markerRefs.current[segment.id]) {
        markerRefs.current[segment.id].forEach(m => { try { m.remove(); } catch (_) {} });
      }
      markerRefs.current[segment.id] = [];

      if (!segment.visible) return;

      if (segment.points.length >= 2) {
        try {
          const line = L.polyline(segment.points.map(p => [p.lat, p.lng]), {
            color: isMergeSource ? '#10b981' : segment.color, weight: (isActive || isMergeSource) && interactionMode !== 'pan' ? 12 : 6, opacity: isActive || isMergeSource ? 1 : 0.6, lineCap: 'round', interactive: true,
            className: isMergeSource ? 'merge-source-anim' : (interactionMode === 'delete' ? 'hover-delete' : (interactionMode === 'eraser' ? 'hover-erase' : (interactionMode === 'reverse' ? 'hover-reverse' : '')))
          }).addTo(mapRef.current);
          line.on('click', (e: any) => {
            L.DomEvent.stopPropagation(e); const { interactionMode } = stateRef.current;
            if (interactionMode === 'delete') deleteSegment(segment.id); 
            else if (interactionMode === 'eraser') handleErase(segment.id, e.latlng);
            else if (interactionMode === 'reverse') reverseSegment(segment.id);
            else if (interactionMode === 'merge') { if (!mergeSourceId) setMergeSourceId(segment.id); else if (mergeSourceId !== segment.id) executeMerge(mergeSourceId, segment.id); }
            else if (interactionMode === 'scissor') handleSplit(segment.id, e.latlng); else setActiveSegmentId(segment.id);
          });
          polylineRefs.current[segment.id].push(line);
        } catch (_) {}
      }
      
      if (segment.points.length > 0) {
        const s = segment.points[0]; const e = segment.points[segment.points.length - 1];
        try {
          markerRefs.current[segment.id] = [
            L.marker([s.lat, s.lng], { icon: L.divIcon({ className:'custom-flag', html: `<div style="background:#10b981; color:white; padding:1px 4px; border-radius:4px; font-size:7px; font-weight:bold; border:1px solid white;">S</div>`, iconSize:[16,16] }) }).addTo(mapRef.current),
            L.marker([e.lat, e.lng], { icon: L.divIcon({ className:'custom-flag', html: `<div style="background:#ef4444; color:white; padding:1px 4px; border-radius:4px; font-size:7px; font-weight:bold; border:1px solid white;">E</div>`, iconSize:[16,16] }) }).addTo(mapRef.current)
          ];
        } catch (_) {}
      }
    });

    const currentIds = new Set(segments.map(s => s.id));
    Object.keys(polylineRefs.current).forEach(id => {
      if (!currentIds.has(id)) {
        polylineRefs.current[id].forEach(l => { try { l.remove(); } catch (_) {} });
        delete polylineRefs.current[id];
      }
    });
    Object.keys(markerRefs.current).forEach(id => {
      if (!currentIds.has(id)) {
        markerRefs.current[id].forEach(m => { try { m.remove(); } catch (_) {} });
        delete markerRefs.current[id];
      }
    });

    if (routingPolylineRef.current) {
      try { routingPolylineRef.current.remove(); } catch (_) {}
      routingPolylineRef.current = null;
    }
    const flatRoutingPoints = routingParts.flatMap(p => p.path);
    if (flatRoutingPoints.length >= 2) {
      try {
        routingPolylineRef.current = L.polyline(flatRoutingPoints.map(p => [p.lat, p.lng]), { 
          color: '#3b82f6', weight: 5, opacity: 0.9, dashArray: '12, 12', className: 'animate-pulse' 
        }).addTo(mapRef.current);
      } catch (_) {}
    }
    
    routingMarkersRef.current.forEach(m => { try { m.remove(); } catch (_) {} });
    routingMarkersRef.current = routingParts.map((p, idx) => {
      const isLast = idx === routingParts.length - 1;
      try {
        return L.circleMarker([p.to.lat, p.to.lng], { 
          radius: isLast ? 8 : 5, color: isLast ? '#ef4444' : '#1e40af', fillColor: '#ffffff', fillOpacity: 1, weight: 3 
        }).addTo(mapRef.current);
      } catch (_) {
        return null;
      }
    }).filter(Boolean);

  }, [segments, activeSegmentId, mergeSourceId, interactionMode, mapReady, routingParts]);

  const activeStats = useMemo(() => {
    const active = segments.find(s => s.id === activeSegmentId);
    if (!active || active.points.length < 2) return null;
    let t = 0; for (let i = 0; i < active.points.length - 1; i++) t += getDistance(active.points[i], active.points[i+1]);
    return { total: t };
  }, [segments, activeSegmentId]);

  const totalStats = useMemo(() => {
    let totalKm = 0;
    segments.filter(s => s.visible).forEach(seg => { for (let i = 0; i < seg.points.length - 1; i++) totalKm += getDistance(seg.points[i], seg.points[i+1]); });
    return totalKm;
  }, [segments]);

  const handleExport = useCallback(async () => {
    const hasAnyPoints = segments.some(s => s.visible && s.points.length > 0);
    if (!hasAnyPoints) {
      alert("Δεν υπάρχουν ορατές διαδρομές για εξαγωγή. Εμφανίστε τουλάχιστον μία!");
      return;
    }
    try {
      await exportToGPX(segments, "Enduro_Route");
    } catch (err: any) {
      alert("Σφάλμα κατά την εξαγωγή: " + err.message);
    }
  }, [segments]);

  const handleExportKML = useCallback(async () => {
    const hasAnyPoints = segments.some(s => s.visible && s.points.length > 0);
    if (!hasAnyPoints) {
      alert("Δεν υπάρχουν ορατές διαδρομές για εξαγωγή. Εμφανίστε τουλάχιστον μία!");
      return;
    }
    try {
      await exportToKML(segments, "Enduro_Route");
    } catch (err: any) {
      alert("Σφάλμα κατά την εξαγωγή (KML): " + err.message);
    }
  }, [segments]);

  const ToolButton = ({ mode, icon: Icon, label, shortcut, colorClass = 'bg-orange-500' }: { mode: InteractionMode, icon: any, label: string, shortcut?: string, colorClass?: string }) => {
    const isActive = interactionMode === mode;
    return (
      <div className="relative group/tool flex flex-col items-center shrink-0">
        <button 
          onClick={() => { if (mode === 'merge') setMergeSourceId(null); setInteractionMode(mode); }} 
          className={`p-3 rounded-xl transition-all duration-200 shadow-lg ${isActive ? `${colorClass} text-white scale-110` : 'text-zinc-400 hover:bg-zinc-800 bg-zinc-900/80 border border-zinc-700/50'}`} 
          title={`${label}${shortcut ? ` [${shortcut.toUpperCase()}]` : ''}`}
        >
          <Icon size={isMobile ? 22 : 20}/>
        </button>
        <div className={`flex flex-col items-center mt-1 transition-all duration-300 ${isActive ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-1 group-hover/tool:opacity-100 group-hover/tool:translate-y-0'}`}>
           <span className={`text-[8px] font-bold uppercase whitespace-nowrap ${isActive ? 'text-white' : 'text-zinc-500'}`}>{label}</span>
           {shortcut && (
             <span className="text-[7px] font-black text-orange-500 bg-orange-500/10 px-1 rounded border border-orange-500/20 mt-0.5 shadow-sm">
               {shortcut.toUpperCase()}
             </span>
           )}
        </div>
      </div>
    );
  };

  return (
    <div className="flex w-full h-full min-h-full bg-zinc-950 text-white font-sans overflow-hidden relative select-none">
      <style>{`.merge-source-anim { stroke-dasharray: 10, 15; animation: dash 5s linear infinite; } @keyframes dash { to { stroke-dashoffset: 200; } } .hover-delete:hover { stroke: #ef4444 !important; stroke-width: 14 !important; cursor: pointer; } .hover-erase:hover { stroke: #fb923c !important; stroke-width: 14 !important; filter: drop-shadow(0 0 10px #fb923c); } .hover-reverse:hover { stroke: #3b82f6 !important; stroke-width: 14 !important; filter: drop-shadow(0 0 10px #fb923c); cursor: pointer; }`}</style>
      
      <input type="file" multiple ref={fileInputRef} onChange={async (e) => {
        const files = Array.from(e.target.files || []) as File[];
        pushToHistory(); 
        let allImported: RouteSegment[] = [];
        
        try {
          for (const file of files) {
            const ext = file.name.toLowerCase().split('.').pop();
            let imported: RouteSegment[] = [];
            
            if (ext === 'gpx') {
              imported = await parseGPX(file);
            } else if (ext === 'kmz' || ext === 'kml') {
              imported = await parseKMZ(file);
            } else {
              console.warn(`Μη υποστηριζόμενος τύπος αρχείου: ${file.name}`);
              continue;
            }
            
            allImported = [...allImported, ...imported.map(s => ({ ...s, color: getNextColor() }))];
          }
          
          if (allImported.length > 0) {
            setSegments(prev => [...prev, ...allImported]);
            if (mapRef.current) {
              const bounds = allImported.flatMap(s => s.points.map(p => [p.lat, p.lng]));
              mapRef.current.fitBounds(bounds, { padding: [50, 50] });
            }
          }
        } catch (err: any) {
          alert(`Σφάλμα εισαγωγής: ${err.message}`);
        }
        e.target.value = '';
      }} accept=".gpx,.kmz,.kml" className="hidden" />

      <div className={`bg-zinc-900 border-zinc-800 transition-all duration-300 z-[2000] flex flex-col shrink-0 ${isMobile ? (isSidebarOpen ? 'fixed inset-0 w-full h-full' : 'w-0 overflow-hidden') : (isSidebarOpen ? 'w-80 h-full border-r' : 'w-0 overflow-hidden')}`}>
        <div className="p-4 flex items-center justify-between bg-zinc-950 border-b border-zinc-800">
          <h1 className="text-lg font-black text-orange-500 flex items-center gap-2"><Navigation size={20}/> Enduro Plan</h1>
          <button onClick={() => setIsSidebarOpen(false)} className="p-2 hover:bg-zinc-800 rounded-full"><X size={20}/></button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4 no-scrollbar">
          <div className="space-y-2">
             <button onClick={() => { pushToHistory(); const id = Math.random().toString(36).substr(2,9); setSegments(p => [...p, { id, name: `Διαδρομή ${p.length+1}`, points:[], color: getNextColor(), visible:true }]); setActiveSegmentId(id); setInteractionMode('draw'); setIsSidebarOpen(false); }} className={`w-full py-4 rounded-xl font-bold flex items-center justify-center gap-2 shadow-lg transition-all bg-orange-600 hover:bg-orange-500 active:scale-95`}><Plus size={20}/> ΝΕΑ ΣΧΕΔΙΑΣΗ</button>
          </div>
          
          <div className="space-y-2">
            <h2 className="text-[10px] font-black text-zinc-500 uppercase px-1">ΔΙΑΔΡΟΜΕΣ ({segments.length})</h2>
            {segments.length === 0 ? (
              <div className="text-center py-10 opacity-30 flex flex-col items-center"><MapIcon size={40} className="mb-2" /><p className="text-[10px] font-bold">ΚΑΜΙΑ ΔΙΑΔΡΟΜΗ</p></div>
            ) : segments.map(seg => (
              <div key={seg.id} onClick={() => { setActiveSegmentId(seg.id); if (isMobile) setIsSidebarOpen(false); }} className={`p-3 rounded-xl border cursor-pointer transition-all ${activeSegmentId === seg.id ? 'bg-orange-500/10 border-orange-500/50 shadow-inner' : 'bg-zinc-800/50 border-zinc-700 hover:bg-zinc-800'}`}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-2.5 h-2.5 rounded-full" style={{backgroundColor:seg.color}}/>
                    <span className={`text-xs font-bold truncate max-w-[120px] ${!seg.visible ? 'text-zinc-600 line-through' : ''}`}>{seg.name}</span>
                  </div>
                  <div className="flex items-center gap-1">
                     <button onClick={(e) => { e.stopPropagation(); toggleVisibility(seg.id); }} className={`p-1 transition-colors ${seg.visible ? 'text-zinc-400 hover:text-white' : 'text-orange-500 hover:text-orange-400'}`} title={seg.visible ? 'Απόκρυψη' : 'Εμφάνιση'}>{seg.visible ? <Eye size={16}/> : <EyeOff size={16}/>}</button>
                     <button onClick={(e) => { e.stopPropagation(); deleteSegment(seg.id); }} className="text-zinc-600 hover:text-red-500 p-1" title="Διαγραφή"><Trash2 size={16}/></button>
                  </div>
                </div>
                {activeSegmentId === seg.id && activeStats && (
                  <div className="mt-2 pt-2 border-t border-zinc-700/50 flex flex-col gap-2">
                    <div className="flex justify-between text-[9px] font-bold text-zinc-400"><span>ΜΗΚΟΣ</span><span className="text-white">{activeStats.total.toFixed(2)} km</span></div>
                    <div className="grid grid-cols-2 gap-1">
                      <button onClick={(e) => { e.stopPropagation(); reverseSegment(seg.id); }} className="py-1.5 bg-zinc-700 rounded-lg text-[8px] font-bold hover:bg-zinc-600 flex items-center justify-center gap-1"><ArrowRightLeft size={10}/> ΑΝΤΙΣΤΡΟΦΗ</button>
                      <button onClick={(e) => { e.stopPropagation(); setInteractionMode('extend'); setIsSidebarOpen(false); }} className="py-1.5 bg-orange-900/30 text-orange-400 border border-orange-500/20 rounded-lg text-[8px] font-bold hover:bg-orange-900/50 flex items-center justify-center gap-1"><MoveUpRight size={10}/> ΣΥΝΕΧΕΙΑ</button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

          <div className="p-4 border-t border-zinc-800/80 space-y-2.5">
            <h2 className="text-[10px] font-black text-zinc-500 uppercase px-1">ΥΠΟΒΑΘΡΟ ΧΑΡΤΗ</h2>
            <div className="grid grid-cols-2 gap-2">
              {[
                { id: 'esri-satellite', name: 'Esri Satellite', desc: 'World Imagery (Προτεινόμενο)' },
                { id: 'google-hybrid', name: 'Google Hybrid', desc: 'Δορυφόρος + Δρόμοι' },
                { id: 'google-satellite', name: 'Google Earth', desc: 'Καθαρός Δορυφόρος' },
                { id: 'google-terrain', name: 'Google Terrain', desc: 'Ανάγλυφο + Υψόμετρα' },
                { id: 'opentopo', name: 'OpenTopoMap', desc: 'Τοπογραφικός' },
                { id: 'osm', name: 'Street Map', desc: 'OpenStreetMap' },
              ].map(b => (
                <button
                  key={b.id}
                  onClick={() => setActiveBasemap(b.id as BasemapId)}
                  className={`p-2 rounded-xl border text-left transition-all ${activeBasemap === b.id ? 'bg-orange-500/15 border-orange-500 text-white shadow-md' : 'bg-zinc-800/40 border-zinc-800 text-zinc-400 hover:border-zinc-700 hover:text-white'}`}
                >
                  <p className="text-[10px] font-bold leading-tight">{b.name}</p>
                  <p className="text-[7.5px] opacity-65 mt-0.5 leading-none">{b.desc}</p>
                </button>
              ))}
            </div>
          </div>

          <div className="p-4 bg-zinc-950 border-t border-zinc-800 space-y-2">
            <button onClick={() => fileInputRef.current?.click()} className="w-full bg-zinc-800 py-2.5 rounded-lg flex items-center justify-center gap-2 text-[11px] font-bold border border-zinc-700 hover:bg-zinc-700"><Upload size={14}/> ΕΙΣΑΓΩΓΗ GPX/KMZ</button>
            <div className="grid grid-cols-2 gap-2">
              <button onClick={handleExport} className="bg-emerald-600/95 hover:bg-emerald-500 py-2.5 rounded-lg flex items-center justify-center gap-1.5 text-[11px] font-bold transition-all"><Download size={14}/> GPX</button>
              <button onClick={handleExportKML} className="bg-blue-600/95 hover:bg-blue-500 py-2.5 rounded-lg flex items-center justify-center gap-1.5 text-[11px] font-bold transition-all"><Globe size={14}/> KML (Earth)</button>
            </div>
          </div>
      </div>

      <div className={`flex-1 relative bg-zinc-900 h-full`}>
        {isOffline && (<div className="absolute top-0 left-0 right-0 z-[5000] bg-red-600 text-white text-[10px] font-bold py-1 text-center flex items-center justify-center gap-2"><WifiOff size={12} /> ΕΙΣΤΕ ΕΚΤΟΣ ΣΥΝΔΕΣΗΣ</div>)}
        <div className="absolute inset-0 z-10"><div id="map-container" ref={mapContainerRef} className="w-full h-full" style={{ width: '100%', height: '100%' }} /></div>
        
        <div className="absolute top-4 right-4 z-[1000] flex flex-col gap-2 pointer-events-auto">
          <div className="flex flex-col gap-2">
            <button onClick={handleUndo} disabled={history.length === 0 && (interactionMode !== 'route' || routingParts.length === 0)} className={`p-2.5 rounded-xl bg-zinc-900/90 border border-zinc-700 shadow-xl transition-all ${ (history.length > 0 || (interactionMode === 'route' && routingParts.length > 0)) ? 'text-white' : 'text-zinc-600 opacity-50 cursor-not-allowed'}`} title="Αναίρεση [Ctrl+Z]"><Undo2 size={22}/></button>
            <button onClick={handleRedo} disabled={redoHistory.length === 0 && (interactionMode !== 'route' || routingRedoParts.length === 0)} className={`p-2.5 rounded-xl bg-zinc-900/90 border border-zinc-700 shadow-xl transition-all ${ (redoHistory.length > 0 || (interactionMode === 'route' && routingRedoParts.length > 0)) ? 'text-white' : 'text-zinc-600 opacity-50 cursor-not-allowed'}`} title="Ακύρωση [Ctrl+Shift+Z]"><Redo2 size={22}/></button>
          </div>
          <button onClick={toggleFullscreen} className={`p-2.5 rounded-xl bg-zinc-900/90 border shadow-xl transition-all ${isFullscreen ? 'text-orange-500 border-orange-500' : 'text-emerald-500 border-zinc-700'}`} title={isFullscreen ? "Έξοδος από Fullscreen [F]" : "Είσοδος σε Fullscreen (Locked Mode) [F]"}>
            {isFullscreen ? <Minimize2 size={22}/> : <Maximize2 size={22}/>}
          </button>
          <div className="relative">
            <button onClick={() => setShowLayerMenu(!showLayerMenu)} className={`p-2.5 rounded-xl bg-zinc-900/90 border shadow-xl transition-all ${showLayerMenu ? 'text-white bg-orange-600 border-orange-500' : 'text-orange-500 border-zinc-700 hover:text-orange-400'} active:scale-95`} title="Επιλογή Υποβάθρου Χάρτη">
              <Layers size={22}/>
            </button>
            {showLayerMenu && (
              <div className="absolute right-0 top-12 w-48 bg-zinc-900 border border-zinc-700 rounded-2xl shadow-2xl p-2 flex flex-col gap-1.5 z-[2500]">
                <div className="text-[10px] font-bold text-zinc-400 px-2 py-1 uppercase border-b border-zinc-800 flex justify-between items-center">
                  <span>Υπόβαθρο</span>
                  <button onClick={() => setShowLayerMenu(false)} className="text-zinc-500 hover:text-white"><X size={12}/></button>
                </div>
                {[
                  { id: 'esri-satellite', label: 'Esri Satellite', sub: 'World Imagery (Προτεινόμενο)' },
                  { id: 'google-hybrid', label: 'Google Hybrid', sub: 'Δορυφόρος + Δρόμοι' },
                  { id: 'google-satellite', label: 'Google Earth', sub: 'Καθαρός Δορυφόρος' },
                  { id: 'google-terrain', label: 'Google Terrain', sub: 'Ανάγλυφο' },
                  { id: 'opentopo', label: 'OpenTopoMap', sub: 'Ισοϋψείς' },
                  { id: 'osm', label: 'Street Map', sub: 'OpenStreetMap' },
                ].map(item => (
                  <button
                    key={item.id}
                    onClick={() => {
                      setActiveBasemap(item.id as BasemapId);
                      setShowLayerMenu(false);
                    }}
                    className={`px-2.5 py-1.5 rounded-xl text-left transition-all text-xs font-semibold ${activeBasemap === item.id ? 'bg-orange-600 text-white font-bold' : 'text-zinc-300 hover:bg-zinc-800'}`}
                  >
                    <div className="leading-tight">{item.label}</div>
                    <div className="text-[9px] opacity-70 leading-none mt-0.5">{item.sub}</div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {basemapNotice && (
          <div className="absolute top-4 left-1/2 -translate-x-1/2 z-[3000] bg-zinc-900/95 border border-orange-500 text-white text-xs px-4 py-2.5 rounded-xl shadow-2xl flex items-center gap-2 max-w-[90vw] text-center">
            <span className="text-orange-500 font-bold">ℹ️</span>
            <span>{basemapNotice}</span>
            <button onClick={() => setBasemapNotice(null)} className="ml-2 text-zinc-400 hover:text-white"><X size={14}/></button>
          </div>
        )}

        <div className="absolute inset-0 pointer-events-none z-[1000] p-4 flex flex-col justify-between">
          <div className="flex items-start justify-between">
            {!isSidebarOpen && (<button onClick={() => setIsSidebarOpen(true)} className="pointer-events-auto bg-zinc-900/95 p-3 rounded-xl border border-zinc-700 text-orange-500 shadow-xl flex items-center gap-2"><Menu size={24}/><span className="hidden md:block text-xs font-bold">ΜΕΝΟΥ</span></button>)}
            {interactionMode !== 'pan' && (
              <div className="flex flex-col items-center gap-2 pointer-events-auto absolute left-1/2 -translate-x-1/2 top-4">
                <div className="px-6 py-2 rounded-full font-black text-[10px] uppercase tracking-widest border-2 shadow-2xl bg-orange-600 border-white text-white flex flex-col items-center gap-1 animate-pulse min-w-[220px]">
                  <div className="flex items-center gap-2">{isRoutingLoading && <Loader2 size={14} className="animate-spin" />}ΛΕΙΤΟΥΡΓΙΑ: {interactionMode.toUpperCase()}</div>
                  {(interactionMode === 'draw' || interactionMode === 'extend') && (<div className={`text-[7px] px-1.5 rounded flex items-center gap-1 transition-colors ${isSpacePressed ? 'bg-emerald-500/40 text-white' : 'bg-white/20'}`}><Hand size={10} /> {isSpacePressed ? 'Μετακίνηση Ενεργή' : 'Space για Μετακίνηση'}</div>)}
                </div>
                <button onClick={() => { if (interactionMode === 'route') finishRouting(); else setInteractionMode('pan'); }} className="bg-emerald-500 text-white px-6 py-2 rounded-xl shadow-xl font-bold text-[10px] border border-white hover:bg-emerald-600 transition-all flex items-center gap-2 pointer-events-auto"><Check size={16} /> ΟΛΟΚΛΗΡΩΣΗ</button>
              </div>
            )}
          </div>

          <div className={`flex justify-center w-full mb-4 pointer-events-none transition-all duration-300 ${isMobile && !isSidebarOpen ? 'pb-24 md:pb-0' : ''}`}>
            <div className="pointer-events-auto flex gap-4">
              <div className="bg-zinc-900/90 border border-zinc-700/50 backdrop-blur-md px-5 py-3 rounded-2xl shadow-2xl flex flex-col items-center min-w-[110px]"><div className="flex items-center gap-2 text-[9px] font-black text-orange-500 uppercase tracking-tighter"><MapIcon size={12} /> ΟΡΑΤΑ</div><div className="text-2xl font-black text-white leading-none mt-1">{totalStats.toFixed(1)} <span className="text-[10px] text-zinc-500">KM</span></div></div>
              {activeStats && (<div className="bg-zinc-900/90 border border-orange-500/40 backdrop-blur-md px-5 py-3 rounded-2xl shadow-2xl flex flex-col items-center min-w-[110px] animate-in fade-in slide-in-from-bottom-2"><div className="flex items-center gap-2 text-[9px] font-black text-white uppercase tracking-tighter"><Activity size={12} className="text-emerald-400" /> ΕΠΙΛΟΓΗ</div><div className="text-2xl font-black text-emerald-400 leading-none mt-1">{activeStats.total.toFixed(2)} <span className="text-[10px] text-zinc-500">KM</span></div></div>)}
            </div>
          </div>
        </div>

        <div className={`absolute z-[1500] transition-all duration-300 ${isMobile ? 'bottom-6 left-1/2 -translate-x-1/2 w-[90vw]' : 'left-6 top-1/2 -translate-y-1/2 flex-col'}`}>
          <div className={`bg-zinc-900/95 border border-zinc-700 p-2.5 rounded-3xl flex gap-3 shadow-2xl pointer-events-auto ${isMobile ? 'overflow-x-auto no-scrollbar justify-between' : 'flex-col items-center'}`}>
            <ToolButton mode="pan" icon={Hand} label="ΧΑΡΤΗΣ" shortcut="A" />
            <div className={isMobile ? "w-[1px] bg-zinc-700/50 mx-1" : "h-[1px] w-full bg-zinc-700/50 my-1"} />
            <ToolButton mode="draw" icon={Pencil} label="ΣΧΕΔΙΑ" shortcut="D" />
            <ToolButton mode="route" icon={Milestone} label="ΟΔΙΚΗ" colorClass="bg-blue-600" />
            <ToolButton mode="extend" icon={MoveUpRight} label="ΕΞΤΕΝΤ" colorClass="bg-orange-400" />
            <ToolButton mode="reverse" icon={RefreshCw} label="ΑΝΤΙΣΤΡ" colorClass="bg-blue-500" />
            <div className={isMobile ? "w-[1px] bg-zinc-700/50 mx-1" : "h-[1px] w-full bg-zinc-700/50 my-1"} />
            <ToolButton mode="eraser" icon={Eraser} label="ΓΟΜΑ" colorClass="bg-amber-600" />
            <ToolButton mode="scissor" icon={Scissors} label="ΚΟΨΙΜΟ" shortcut="B" colorClass="bg-purple-600" />
            <ToolButton mode="merge" icon={GitMerge} label="ΕΝΩΣΗ" shortcut="C" colorClass="bg-emerald-600" />
            <ToolButton mode="delete" icon={Trash2} label="ΔΙΑΓΡ" colorClass="bg-red-600" />
          </div>
        </div>
      </div>
    </div>
  );
};

export default App;
