export interface IUpdateLineData {
  duration: number
  distance: number
  studentsCount: number
  normal_stop_points_count: number
  wheelchair_stop_points_count: number
  routes: IUpdateRouteData[]
}

export interface IUpdateRouteData {
  kind: string
  originalPolyline: string
  updatedPolyline: string
  distance: number
  duration: number
}
