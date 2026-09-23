
export interface Coordinate {
  lat: number;
  lng: number;
  elevation?: number;
}

export interface RouteSegment {
  id: string;
  name: string;
  points: Coordinate[];
  color: string;
  visible: boolean;
  progressIndex?: number;
}

export interface MapState {
  center: [number, number];
  zoom: number;
}
