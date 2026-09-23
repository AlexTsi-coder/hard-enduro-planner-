
import { RouteSegment, Coordinate } from '../types';

export const parseGPX = async (file: File): Promise<RouteSegment[]> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const content = e.target?.result as string;
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(content, "text/xml");
        const segments: RouteSegment[] = [];
        
        const tracks = xmlDoc.getElementsByTagName("trk");
        
        for (let i = 0; i < tracks.length; i++) {
          const track = tracks[i];
          const name = track.getElementsByTagName("name")[0]?.textContent || `Εισαγόμενη Διαδρομή ${i + 1}`;
          const trkSegs = track.getElementsByTagName("trkseg");
          
          for (let j = 0; j < trkSegs.length; j++) {
            const trkSeg = trkSegs[j];
            const trkpts = trkSeg.getElementsByTagName("trkpt");
            const points: Coordinate[] = [];
            
            for (let k = 0; k < trkpts.length; k++) {
              const trkpt = trkpts[k];
              const lat = parseFloat(trkpt.getAttribute("lat") || "0");
              const lng = parseFloat(trkpt.getAttribute("lon") || "0");
              const ele = trkpt.getElementsByTagName("ele")[0]?.textContent;
              
              if (!isNaN(lat) && !isNaN(lng)) {
                points.push({
                  lat,
                  lng,
                  elevation: ele ? parseFloat(ele) : undefined
                });
              }
            }
            
            if (points.length > 0) {
              segments.push({
                id: Math.random().toString(36).substr(2, 9),
                name: trkSegs.length > 1 ? `${name} (Μέρος ${j + 1})` : name,
                points,
                color: '#ffffff', // Προσωρινό χρώμα, θα αντικατασταθεί στο App.tsx
                visible: true
              });
            }
          }
        }
        
        resolve(segments);
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = () => reject(new Error("Σφάλμα κατά την ανάγνωση του αρχείου."));
    reader.readAsText(file);
  });
};
