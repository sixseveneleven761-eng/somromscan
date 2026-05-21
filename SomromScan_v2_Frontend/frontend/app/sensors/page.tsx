'use client'
import { useEffect, useState, useRef, useCallback } from 'react'
import { api, SensorReading, Project } from '@/lib/api'
import { Activity, AlertTriangle, Wifi, WifiOff, RefreshCw, Cpu, Zap } from 'lucide-react'

const REFRESH_INTERVAL = 5000 // 5 seconds

export default function SensorsPage() {
  const [projects, setProjects] = useState<Project[]>([])
  const [readings, setReadings] = useState<SensorReading[]>([])
  const [selectedProject, setSelectedProject] = useState<number | null>(null)
  const [anomaliesOnly, setAnomaliesOnly] = useState(false)
  const [loading, setLoading] = useState(false)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [isLive, setIsLive] = useState(true)
  const [newReadingIds, setNewReadingIds] = useState<Set<number>>(new Set())
  const [countdown, setCountdown] = useState(REFRESH_INTERVAL / 1000)
  const prevReadingIds = useRef<Set<number>>(new Set())
  const intervalRef = useRef<NodeJS.Timeout | null>(null)
  const countdownRef = useRef<NodeJS.Timeout | null>(null)

  useEffect(() => {
    api.projects.list().then(setProjects)
  }, [])

  const fetchReadings = useCallback(async (silent = false) => {
    if (!selectedProject) return
    if (!silent) setLoading(true)
    try {
      const data = await api.sensors.projectReadings(selectedProject, anomaliesOnly)
      const incomingIds = new Set(data.map(r => r.id))
      const freshIds = new Set<number>()
      incomingIds.forEach(id => {
        if (!prevReadingIds.current.has(id)) freshIds.add(id)
      })
      if (freshIds.size > 0) setNewReadingIds(freshIds)
      setTimeout(() => setNewReadingIds(new Set()), 3000)
      prevReadingIds.current = incomingIds
      setReadings(data)
      setLastUpdated(new Date())
    } finally {
      if (!silent) setLoading(false)
    }
  }, [selectedProject, anomaliesOnly])

  // Initial load
  useEffect(() => {
    if (!selectedProject) { setReadings([]); return }
    fetchReadings(false)
  }, [selectedProject, anomaliesOnly, fetchReadings])

  // Auto-refresh polling
  useEffect(() => {
    if (!selectedProject || !isLive) {
      if (intervalRef.current) clearInterval(intervalRef.current)
      if (countdownRef.current) clearInterval(countdownRef.current)
      return
    }
    setCountdown(REFRESH_INTERVAL / 1000)
    intervalRef.current = setInterval(() => {
      fetchReadings(true)
      setCountdown(REFRESH_INTERVAL / 1000)
    }, REFRESH_INTERVAL)
    countdownRef.current = setInterval(() => {
      setCountdown(c => (c > 1 ? c - 1 : REFRESH_INTERVAL / 1000))
    }, 1000)
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
      if (countdownRef.current) clearInterval(countdownRef.current)
    }
  }, [selectedProject, isLive, fetchReadings])

  const TIER_LABELS: Record<string, string> = {
    arcore: '📱 ARCore',
    uwb: '📡 UWB',
    stereo: '📷 Stereo',
    esp32: '🔌 ESP32',
    iot: '🔌 IoT',
  }

  const anomalyCount = readings.filter(r => r.is_anomaly).length
  const dbhReadings = readings.filter(r => r.dbh_cm)
  const avgDbh = dbhReadings.length > 0
    ? (dbhReadings.reduce((s, r) => s + (r.dbh_cm || 0), 0) / dbhReadings.length).toFixed(1)
    : '—'
  const avgConf = readings.length > 0
    ? (readings.reduce((s, r) => s + (r.confidence_score || 0), 0) / readings.length).toFixed(0)
    : '—'

  return (
    <div className="p-8 max-w-[1400px]">
      {/* Header */}
      <div className="mb-6 flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-bold text-[#1F3D2E] flex items-center gap-3">
            Sensor Data
            {selectedProject && isLive && (
              <span className="flex items-center gap-1.5 text-sm font-semibold bg-green-100 text-green-700 px-3 py-1 rounded-full border border-green-300">
                <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse inline-block" />
                LIVE
              </span>
            )}
          </h1>
          <p className="text-gray-500 mt-1">ข้อมูล Sensor แบบ Real-time + Anomaly Detection</p>
          {lastUpdated && (
            <p className="text-xs text-gray-400 mt-0.5">
              อัปเดตล่าสุด: {lastUpdated.toLocaleTimeString('th-TH')}
              {isLive && selectedProject && <span className="ml-2 text-green-500">• รีเฟรชใน {countdown}s</span>}
            </p>
          )}
        </div>

        {/* ESP32 Guide badge */}
        <a
          href="#esp32-guide"
          className="flex items-center gap-2 bg-[#1F3D2E] text-white px-4 py-2.5 rounded-xl text-sm font-semibold hover:bg-[#2C5F2D] transition-colors"
        >
          <Cpu className="w-4 h-4" />
          ดูวิธีเชื่อม ESP32
        </a>
      </div>

      {/* Filters */}
      <div className="flex gap-3 mb-6 flex-wrap items-center">
        <select
          className="px-4 py-2.5 rounded-xl border border-gray-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
          value={selectedProject || ''}
          onChange={e => setSelectedProject(e.target.value ? parseInt(e.target.value) : null)}
        >
          <option value="">เลือกโครงการ</option>
          {projects.map(p => <option key={p.id} value={p.id}>{p.name_th || p.name}</option>)}
        </select>

        <button
          onClick={() => setAnomaliesOnly(!anomaliesOnly)}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl border text-sm font-medium transition-colors ${
            anomaliesOnly ? 'bg-red-600 text-white border-red-600' : 'bg-white text-gray-600 border-gray-200 hover:border-red-300'
          }`}
        >
          <AlertTriangle className="w-4 h-4" />
          Anomalies เท่านั้น
        </button>

        {selectedProject && (
          <>
            <button
              onClick={() => setIsLive(l => !l)}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-xl border text-sm font-medium transition-colors ${
                isLive ? 'bg-green-600 text-white border-green-600' : 'bg-white text-gray-600 border-gray-200 hover:border-green-300'
              }`}
            >
              {isLive ? <Wifi className="w-4 h-4" /> : <WifiOff className="w-4 h-4" />}
              {isLive ? 'Auto-refresh ON' : 'Auto-refresh OFF'}
            </button>

            <button
              onClick={() => fetchReadings(false)}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-gray-200 bg-white text-gray-600 text-sm font-medium hover:border-green-300 transition-colors"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              รีเฟรชเดี๋ยวนี้
            </button>
          </>
        )}
      </div>

      {/* Summary cards */}
      {readings.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          {[
            { label: 'การวัดทั้งหมด', value: readings.length, icon: Activity },
            { label: 'Anomalies', value: anomalyCount, alert: anomalyCount > 0, icon: AlertTriangle },
            { label: 'DBH เฉลี่ย (cm)', value: avgDbh, icon: Zap },
            { label: 'Confidence เฉลี่ย (%)', value: `${avgConf}%`, icon: Wifi },
          ].map(s => (
            <div key={s.label} className={`rounded-xl p-4 flex items-center gap-3 ${s.alert ? 'bg-red-50 border border-red-200' : 'bg-white border border-gray-100 shadow-sm'}`}>
              <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${s.alert ? 'bg-red-100' : 'bg-green-50'}`}>
                <s.icon className={`w-5 h-5 ${s.alert ? 'text-red-600' : 'text-green-600'}`} />
              </div>
              <div>
                <div className={`text-2xl font-bold ${s.alert ? 'text-red-700' : 'text-gray-900'}`}>{s.value}</div>
                <div className="text-xs text-gray-500 mt-0.5">{s.label}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Readings table */}
      {loading ? (
        <div className="text-center py-20 text-gray-400">
          <RefreshCw className="w-10 h-10 mx-auto mb-3 animate-spin text-green-400" />
          กำลังโหลด...
        </div>
      ) : !selectedProject ? (
        <div className="text-center py-20 text-gray-400">
          <Activity className="w-16 h-16 mx-auto mb-4 text-gray-200" />
          <div>เลือกโครงการด้านบน</div>
          <div className="text-sm mt-1">ระบบจะ refresh อัตโนมัติทุก {REFRESH_INTERVAL / 1000} วินาที</div>
        </div>
      ) : readings.length === 0 ? (
        <div className="text-center py-20 text-gray-400">ไม่มีข้อมูล sensor readings</div>
      ) : (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-[#1F3D2E] text-white">
                {['', 'Timestamp', 'Tree ID', 'Type', 'DBH (cm)', 'H (m)', 'CO₂ (kg)', 'Confidence', 'Tier', 'Status'].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-semibold">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {readings.slice(0, 50).map((r, i) => {
                const isNew = newReadingIds.has(r.id)
                return (
                  <tr
                    key={r.id}
                    className={`transition-all duration-700 ${
                      isNew
                        ? 'bg-green-100 animate-pulse'
                        : r.is_anomaly
                        ? 'bg-red-50'
                        : i % 2 === 0 ? 'bg-white' : 'bg-gray-50'
                    } hover:bg-yellow-50`}
                  >
                    <td className="px-3 py-2.5">
                      {isNew && (
                        <span className="text-xs font-bold text-green-700 bg-green-200 px-1.5 py-0.5 rounded-full whitespace-nowrap">NEW</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-gray-500 text-xs whitespace-nowrap">
                      {new Date(r.timestamp).toLocaleString('th-TH', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                    </td>
                    <td className="px-4 py-2.5 text-gray-600 font-mono text-xs">{r.tree_id ? `T-${r.tree_id}` : '—'}</td>
                    <td className="px-4 py-2.5 text-gray-700">{r.measurement_type}</td>
                    <td className="px-4 py-2.5 font-medium text-gray-900">{r.dbh_cm?.toFixed(1) || '—'}</td>
                    <td className="px-4 py-2.5 text-gray-700">{r.height_m?.toFixed(1) || '—'}</td>
                    <td className="px-4 py-2.5 text-green-700 font-medium">{r.co2_kg?.toFixed(1) || '—'}</td>
                    <td className="px-4 py-2.5">
                      <div className={`text-xs font-medium ${(r.confidence_score || 0) >= 80 ? 'text-green-600' : (r.confidence_score || 0) >= 60 ? 'text-amber-600' : 'text-red-600'}`}>
                        {r.confidence_score?.toFixed(0)}%
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-gray-600 text-xs">{TIER_LABELS[r.tier] || r.tier}</td>
                    <td className="px-4 py-2.5">
                      {r.is_anomaly ? (
                        <div className="group relative">
                          <span className="text-red-600 text-xs font-medium cursor-help">⚠️ anomaly</span>
                          <div className="absolute bottom-full left-0 bg-red-900 text-white text-xs p-2 rounded-lg hidden group-hover:block w-48 z-10">
                            {r.anomaly_reason}
                          </div>
                        </div>
                      ) : (
                        <span className="text-green-600 text-xs">✅ ปกติ</span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {readings.length > 50 && (
            <div className="p-3 text-center text-sm text-gray-400 border-t border-gray-100">
              แสดง 50 จาก {readings.length} รายการ
            </div>
          )}
        </div>
      )}

      {/* ============ ESP32 GUIDE ============ */}
      <div id="esp32-guide" className="mt-12 bg-[#0d1117] rounded-2xl overflow-hidden border border-gray-700">
        <div className="px-6 py-4 border-b border-gray-700 flex items-center gap-3">
          <Cpu className="w-5 h-5 text-green-400" />
          <span className="text-white font-bold">คู่มือเชื่อม ESP32 → SomromScan</span>
          <span className="ml-auto text-xs text-gray-400">Arduino IDE / C++</span>
        </div>

        <div className="p-6 space-y-6">
          {/* Step 1 */}
          <div>
            <div className="text-green-400 text-xs font-mono mb-2">// STEP 1: ติดตั้ง Library ใน Arduino IDE</div>
            <div className="text-gray-400 text-sm mb-3">
              ไปที่ <span className="text-white">Sketch → Include Library → Manage Libraries</span> แล้วค้นหาและติดตั้ง:
            </div>
            <div className="bg-gray-900 rounded-xl p-4 font-mono text-sm space-y-1">
              <div className="text-yellow-300">WiFi</div>
              <div className="text-yellow-300">HTTPClient</div>
              <div className="text-yellow-300">ArduinoJson <span className="text-gray-500">// by Benoit Blanchon</span></div>
              <div className="text-yellow-300">DHT sensor library <span className="text-gray-500">// ถ้าใช้ DHT22</span></div>
            </div>
          </div>

          {/* Step 2 */}
          <div>
            <div className="text-green-400 text-xs font-mono mb-2">// STEP 2: หา IP ของเครื่องคอมพิวเตอร์ที่รัน backend</div>
            <div className="text-gray-400 text-sm mb-3">เปิด PowerShell แล้วรันคำสั่ง:</div>
            <div className="bg-gray-900 rounded-xl p-4 font-mono text-sm text-cyan-300">
              ipconfig | findstr IPv4
            </div>
            <div className="text-gray-400 text-xs mt-2">จะได้ IP เช่น <span className="text-white font-mono">192.168.1.86</span> — ใช้แทน YOUR_PC_IP ด้านล่าง</div>
          </div>

          {/* Main code */}
          <div>
            <div className="text-green-400 text-xs font-mono mb-2">// STEP 3: โค้ด Arduino สำหรับ ESP32</div>
            <div className="bg-gray-900 rounded-xl p-4 font-mono text-xs leading-relaxed overflow-x-auto">
              <pre className="text-gray-100">{`#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>

// ===== ตั้งค่าตรงนี้ =====
const char* WIFI_SSID     = "ชื่อ_WiFi_ของคุณ";
const char* WIFI_PASSWORD = "รหัส_WiFi_ของคุณ";
const char* SERVER_IP     = "192.168.1.86";   // IP เครื่องคอม
const int   SERVER_PORT   = 8000;
const int   PROJECT_ID    = 1;   // ID โครงการใน SomromScan
const char* DEVICE_ID     = "ESP32-001";

// ===== Pin ต่อ Sensor =====
// ตัวอย่าง: HC-SR04 (ultrasonic วัด DBH)
const int TRIG_PIN = 5;
const int ECHO_PIN = 18;
// ตัวอย่าง: DHT22 (วัดความชื้น-อุณหภูมิ)
// #include <DHT.h>
// DHT dht(4, DHT22);

void setup() {
  Serial.begin(115200);
  pinMode(TRIG_PIN, OUTPUT);
  pinMode(ECHO_PIN, INPUT);
  // dht.begin();

  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.print("Connecting WiFi");
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println("\\nConnected! IP: " + WiFi.localIP().toString());
}

float measureDBH_cm() {
  // HC-SR04: วัดเส้นรอบวง แล้วหาร π
  // วางเทปรอบต้นไม้ + ultrasonic วัดระยะห่าง
  // หรือวัดตรงๆ จากด้านข้าง
  digitalWrite(TRIG_PIN, LOW); delayMicroseconds(2);
  digitalWrite(TRIG_PIN, HIGH); delayMicroseconds(10);
  digitalWrite(TRIG_PIN, LOW);
  
  long duration = pulseIn(ECHO_PIN, HIGH);
  float distance_cm = duration * 0.034 / 2.0;
  
  // ถ้าวัดเส้นผ่าศูนย์กลางตรงๆ ใช้เลยได้
  return distance_cm;
}

void sendToAPI(float dbh_cm, float confidence) {
  if (WiFi.status() != WL_CONNECTED) return;
  
  HTTPClient http;
  String url = "http://" + String(SERVER_IP) + ":" + 
               String(SERVER_PORT) + "/api/sensors";
  
  http.begin(url);
  http.addHeader("Content-Type", "application/json");
  
  // สร้าง JSON payload
  StaticJsonDocument<256> doc;
  doc["project_id"]      = PROJECT_ID;
  // doc["tree_id"]       = 1;  // ใส่ถ้ารู้ว่าเป็นต้นที่เท่าไร
  doc["measurement_type"] = "dbh";
  doc["dbh_cm"]          = dbh_cm;
  doc["tier"]            = "esp32";
  doc["confidence_score"] = confidence;
  doc["device_id"]       = DEVICE_ID;
  
  String body;
  serializeJson(doc, body);
  
  int code = http.POST(body);
  if (code == 200) {
    Serial.println("✅ ส่งข้อมูลสำเร็จ! DBH=" + String(dbh_cm) + "cm");
  } else {
    Serial.println("❌ Error: " + String(code));
  }
  http.end();
}

void loop() {
  float dbh = measureDBH_cm();
  
  // กรองค่าที่ผิดปกติ
  if (dbh > 0.5 && dbh < 200) {
    float confidence = 90.0;  // หรือคำนวณจาก SD ของค่าที่วัด
    sendToAPI(dbh, confidence);
    Serial.println("DBH: " + String(dbh) + " cm");
  } else {
    Serial.println("ค่าผิดปกติ: " + String(dbh));
  }
  
  delay(10000);  // วัดทุก 10 วินาที
}`}</pre>
            </div>
          </div>

          {/* Wiring */}
          <div>
            <div className="text-green-400 text-xs font-mono mb-3">// การต่อสาย HC-SR04 → ESP32</div>
            <div className="grid grid-cols-2 gap-2 text-xs font-mono">
              {[
                ['HC-SR04 VCC', 'ESP32 5V (VIN)'],
                ['HC-SR04 GND', 'ESP32 GND'],
                ['HC-SR04 TRIG', 'ESP32 GPIO 5'],
                ['HC-SR04 ECHO', 'ESP32 GPIO 18'],
              ].map(([from, to]) => (
                <div key={from} className="flex items-center gap-2 bg-gray-900 rounded-lg px-3 py-2">
                  <span className="text-yellow-300">{from}</span>
                  <span className="text-gray-500">→</span>
                  <span className="text-cyan-300">{to}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Test */}
          <div>
            <div className="text-green-400 text-xs font-mono mb-2">// STEP 4: ทดสอบโดยไม่มี Hardware (ใช้ curl)</div>
            <div className="bg-gray-900 rounded-xl p-4 font-mono text-xs text-cyan-300 overflow-x-auto">
              <div className="text-gray-500 mb-1"># รันใน PowerShell เพื่อทดสอบส่งข้อมูล ESP32 ปลอม:</div>
              <div>{`Invoke-RestMethod -Uri "http://localhost:8000/api/sensors" \`
  -Method POST \`
  -ContentType "application/json" \`
  -Body '{"project_id":1,"measurement_type":"dbh","dbh_cm":35.5,"tier":"esp32","confidence_score":92.0,"device_id":"ESP32-TEST"}'`}</div>
            </div>
            <div className="text-gray-400 text-xs mt-2">
              หลังรัน → กลับมาดูหน้า Sensor Data → จะเห็น row ใหม่ไฮไลต์สีเขียวว่า <span className="text-green-400 font-bold">NEW</span> ภายใน 5 วินาที
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
