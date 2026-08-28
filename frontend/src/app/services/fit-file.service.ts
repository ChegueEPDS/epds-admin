import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export interface FitPause {
  id: string;
  start: string;
  end: string;
  duration: number;
  source: string;
}

export interface FitSummary {
  sport: string;
  startTime: string | null;
  endTime: string | null;
  netTime: number;
  grossTime: number;
  pauseTime: number;
  minTemperature: number | null;
  maxTemperature: number | null;
  devices: string[];
  sensors: string[];
  sensorDetails: FitSensor[];
  pauses: FitPause[];
  recordCount: number;
  metrics: FitMetrics;
  laps: FitLap[];
}

export interface FitSensor {
  index: number;
  timestamp: string | null;
  name: string | number | null;
  manufacturer: string | null;
  serialNumber: string | number | null;
  deviceType: string | null;
  batteryStatus: string | null;
  batteryVoltage: number | null;
  softwareVersion: number | null;
  hardwareVersion: number | null;
  sensorPosition: string | null;
}

export interface FitMetrics {
  totalAscent: number | null;
  totalDescent: number | null;
  avgHeartRate: number | null;
  avgPower: number | null;
  normalizedPower: number | null;
  avgCadence: number | null;
  avgSpeed: number | null;
}

export interface FitLap extends FitMetrics {
  id: string;
  label: string;
  startTime: string | null;
  endTime: string | null;
  netTime: number;
  grossTime: number;
  pauseTime: number;
}

export interface FitRecord {
  index: number;
  timestamp: string | null;
  distance: number | null;
  speed: number | null;
  heartRate: number | null;
  cadence: number | null;
  power: number | null;
  altitude: number | null;
  temperature: number | null;
}

export interface FitAnalysis {
  summary: FitSummary;
  records: FitRecord[];
}

@Injectable({ providedIn: 'root' })
export class FitFileService {
  private readonly baseUrl = `${environment.apiUrl}/api/admin/fit`;
  constructor(private http: HttpClient) {}

  analyze(file: File): Observable<FitAnalysis> {
    const body = new FormData();
    body.append('file', file);
    return this.http.post<FitAnalysis>(`${this.baseUrl}/analyze`, body, { withCredentials: true });
  }

  modify(file: File, options: object): Observable<Blob> {
    const body = new FormData();
    body.append('file', file);
    body.append('options', JSON.stringify(options));
    return this.http.post(`${this.baseUrl}/modify`, body, {
      withCredentials: true,
      responseType: 'blob'
    });
  }

  preview(file: File, options: object): Observable<FitAnalysis> {
    const body = new FormData();
    body.append('file', file);
    body.append('options', JSON.stringify(options));
    return this.http.post<FitAnalysis>(`${this.baseUrl}/preview`, body, { withCredentials: true });
  }
}
