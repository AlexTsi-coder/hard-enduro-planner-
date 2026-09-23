
import { RouteSegment } from '../types';

/**
 * Εξαγωγή διαδρομών σε μορφή GPX.
 * Χρησιμοποιεί το File System Access API για επιλογή φακέλου αν είναι διαθέσιμο.
 */
export const exportToGPX = async (segments: RouteSegment[], defaultFileName: string = 'Enduro_Route') => {
  // Έλεγχος αν υπάρχουν σημεία προς εξαγωγή
  const segmentsWithPoints = segments.filter(s => s.visible && s.points.length > 0);
  if (segmentsWithPoints.length === 0) {
    throw new Error("Δεν βρέθηκαν σημεία για εξαγωγή.");
  }

  const cleanName = defaultFileName.replace(/\.[^/.]+$/, "").replace(/_/g, " ");
  
  // Κατασκευή του GPX string
  const gpxHeader = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="EnduroRoutePlanner" 
     xmlns="http://www.topografix.com/GPX/1/1" 
     xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" 
     xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd">
  <metadata>
    <name>${cleanName}</name>
    <desc>Created with Enduro Route Planner</desc>
    <time>${new Date().toISOString()}</time>
  </metadata>
  <trk>
    <name>${cleanName}</name>
    <trkseg>`;

  let trkptContent = '';
  segmentsWithPoints.forEach(segment => {
    segment.points.forEach(pt => {
      trkptContent += `\n      <trkpt lat="${pt.lat.toFixed(6)}" lon="${pt.lng.toFixed(6)}">${pt.elevation !== undefined ? `\n        <ele>${pt.elevation.toFixed(1)}</ele>` : ''}\n      </trkpt>`;
    });
  });

  const gpxFooter = `\n    </trkseg>\n  </trk>\n</gpx>`;
  const fullGPX = gpxHeader + trkptContent + gpxFooter;
  const fileNameWithExt = defaultFileName.toLowerCase().endsWith('.gpx') ? defaultFileName : `${defaultFileName}.gpx`;

  // 1. Προσπάθεια χρήσης του showSaveFilePicker (Desktop Chrome/Edge)
  // Αυτό επιτρέπει την επιλογή φακέλου.
  if ('showSaveFilePicker' in window) {
    try {
      const handle = await (window as any).showSaveFilePicker({
        suggestedName: fileNameWithExt,
        types: [{
          description: 'GPX File',
          accept: { 'application/gpx+xml': ['.gpx'] },
        }],
      });
      const writable = await handle.createWritable();
      await writable.write(fullGPX);
      await writable.close();
      return true;
    } catch (err: any) {
      if (err.name === 'AbortError') return false; // Ο χρήστης ακύρωσε
      console.warn("showSaveFilePicker failed, falling back...", err);
    }
  }

  // 2. Fallback: Κλασική λήψη αρχείου (Mobile ή Firefox/Safari)
  // Εδώ ο browser αποφασίζει τον φάκελο (συνήθως 'Downloads')
  const blob = new Blob([fullGPX], { type: 'application/gpx+xml' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileNameWithExt;
  document.body.appendChild(link);
  link.click();
  
  setTimeout(() => {
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, 250);
  
  return true;
};
