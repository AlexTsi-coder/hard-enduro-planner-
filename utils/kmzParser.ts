
import JSZip from 'jszip';
import { RouteSegment, Coordinate } from '../types';

/**
 * Μετατρέπει ένα κείμενο KML σε RouteSegments
 */
const parseKMLContent = (content: string): RouteSegment[] => {
  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(content, "text/xml");
  const segments: RouteSegment[] = [];
  
  // Αναζήτηση για LineStrings (διαδρομές)
  const placemarks = xmlDoc.getElementsByTagName("Placemark");
  
  for (let i = 0; i < placemarks.length; i++) {
    const placemark = placemarks[i];
    const name = placemark.getElementsByTagName("name")[0]?.textContent || `Διαδρομή KML ${i + 1}`;
    
    // Εστίαση σε LineString geometries
    const lineStrings = placemark.getElementsByTagName("LineString");
    for (let j = 0; j < lineStrings.length; j++) {
      const coordinatesTag = lineStrings[j].getElementsByTagName("coordinates")[0];
      if (coordinatesTag && coordinatesTag.textContent) {
        const coordsText = coordinatesTag.textContent.trim();
        // Το KML έχει μορφή: lon,lat,alt (προαιρετικό) διαχωρισμένα με κενό
        const coordPairs = coordsText.split(/\s+/);
        const points: Coordinate[] = [];
        
        coordPairs.forEach(pair => {
          const parts = pair.split(',');
          if (parts.length >= 2) {
            const lng = parseFloat(parts[0]);
            const lat = parseFloat(parts[1]);
            const ele = parts[2] ? parseFloat(parts[2]) : undefined;
            
            if (!isNaN(lat) && !isNaN(lng)) {
              points.push({ lat, lng, elevation: ele });
            }
          }
        });
        
        if (points.length > 0) {
          segments.push({
            id: Math.random().toString(36).substr(2, 9),
            name: lineStrings.length > 1 ? `${name} (Part ${j + 1})` : name,
            points,
            color: '#ffffff',
            visible: true
          });
        }
      }
    }
  }
  
  return segments;
};

/**
 * Parser για αρχεία .kmz (zip) ή .kml (xml)
 */
export const parseKMZ = async (file: File): Promise<RouteSegment[]> => {
  const extension = file.name.toLowerCase().split('.').pop();
  
  if (extension === 'kml') {
    const text = await file.text();
    return parseKMLContent(text);
  }
  
  if (extension === 'kmz') {
    const zip = new JSZip();
    const contents = await zip.loadAsync(file);
    
    // Αναζήτηση για το κύριο kml αρχείο μέσα στο zip
    const kmlFile = Object.keys(contents.files).find(name => name.toLowerCase().endsWith('.kml'));
    
    if (!kmlFile) {
      throw new Error("Δεν βρέθηκε αρχείο KML μέσα στο KMZ.");
    }
    
    const kmlText = await contents.files[kmlFile].async("string");
    return parseKMLContent(kmlText);
  }
  
  return [];
};
