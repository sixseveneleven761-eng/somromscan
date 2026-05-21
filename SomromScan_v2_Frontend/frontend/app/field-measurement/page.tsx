'use client'
import { useEffect, useState, useRef, useCallback } from 'react'
import { api, Project, SensorReading } from '@/lib/api'
import {
  Ruler, Trees, Wifi, WifiOff, RefreshCw, CheckCircle2,
  AlertTriangle, ClipboardList, Cpu, ChevronRight, X, Activity
} from 'lucide-react'

// ---- Types ----
interface FieldRecord {
  tree_id: string
  dbh_cm: number | null
  height_m: number | null
  note: string
  timestamp: string
  source: 'esp32' | 'manual'
}

export default function VVBFieldPage() {
  const [projects, setProjects] = useState<Project[]>([])
  const [selectedProject, setSelectedProject] = useState<number | null>(null)
  const [liveReadings, setLiveReadings] = useState<SensorReading[]>([])
  const [fieldRecords, setFieldRecords] = useState<FieldRecord[]>([])
  const [isLive, setIsLive] = useState(true)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [newIds, setNewIds] = useState<Set<number>>(new Set())
  const [countdown, setCountdown] = useState(5)
  const [showManual, setShowManual] = useState(false)
  const [manualForm, setManualForm] = useState({ tree_id: '', dbh_cm: '', height_m: '', note: '' })
  const [submitting, setSubmitting] = useState(false)
  const [submitResult, setSubmitResult] = useState<{ ok: boolean; msg: string } | null>(null)
  const prevIds = useRef<Set<number>>(new Set())
  const intervalRef = useRef<NodeJS.Timeout | null>(null)
  const countdownRef = useRef<NodeJS.Timeout | null>(null)

  useEffect(() => { api.projects.list().then(setProjects) }, [])

  const fetchReadings = useCallback(async (silent = false) => {
    if (!selectedProject) return
    const data = await api.sensors.projectReadings(selectedProject, false)
    // filter only height + recent (last 7 days)
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000
    const recent = data.filter(r =>
      new Date(r.timestamp).getTime() > cutoff
    )
    const freshIds = new Set<number>()
    recent.forEach(r => { if (!prevIds.current.has(r.id)) freshIds.add(r.id) })
    if (freshIds.size > 0) {
      setNewIds(freshIds)
      setTimeout(() => setNewIds(new Set()), 4000)
    }
    prevIds.current = new Set(recent.map(r => r.id))
    setLiveReadings(recent)
    setLastUpdated(new Date())
  }, [selectedProject])

  useEffect(() => {
    if (!selectedProject) { setLiveReadings([]); return }
    fetchReadings(false)
  }, [selectedProject, fetchReadings])

  useEffect(() => {
    if (!selectedProject || !isLive) {
      if (intervalRef.current) clearInterval(intervalRef.current)
      if (countdownRef.current) clearInterval(countdownRef.current)
      return
    }
    setCountdown(5)
    intervalRef.current = setInterval(() => { fetchReadings(true); setCountdown(5) }, 5000)
    countdownRef.current = setInterval(() => setCountdown(c => c > 1 ? c - 1 : 5), 1000)
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
      if (countdownRef.current) clearInterval(countdownRef.current)
    }
  }, [selectedProject, isLive, fetchReadings])

  // Submit manual entry
  const handleManualSubmit = async () => {
    if (!selectedProject || !manualForm.tree_id) return
    setSubmitting(true)
    setSubmitResult(null)
    try {
      const payload: any = {
        project_id: selectedProject,
        measurement_type: manualForm.height_m ? 'height' : 'dbh',
        tier: 'manual',
        confidence_score: 80,
        device_id: 'VVB-MANUAL',
      }
      if (manualForm.tree_id) payload.tree_id = parseInt(manualForm.tree_id) || undefined
      if (manualForm.dbh_cm) payload.dbh_cm = parseFloat(manualForm.dbh_cm)
      if (manualForm.height_m) payload.height_m = parseFloat(manualForm.height_m)

      const result = await api.sensors.addReading(payload)
      setSubmitResult({ ok: true, msg: `บันทึกสำเร็จ! ID=${result.id} | CO₂=${result.co2_kg?.toFixed(1) || '—'} kg` })
      setFieldRecords(prev => [{
        tree_id: manualForm.tree_id,
        dbh_cm: manualForm.dbh_cm ? parseFloat(manualForm.dbh_cm) : null,
        height_m: manualForm.height_m ? parseFloat(manualForm.height_m) : null,
        note: manualForm.note,
        timestamp: new Date().toISOString(),
        source: 'manual'
      }, ...prev])
      setManualForm({ tree_id: '', dbh_cm: '', height_m: '', note: '' })
      fetchReadings(true)
    } catch {
      setSubmitResult({ ok: false, msg: 'เกิดข้อผิดพลาด — ตรวจสอบ backend' })
    }
    setSubmitting(false)
  }

  const heightReadings = liveReadings.filter(r => r.height_m || r.measurement_type === 'height')
  const dbhReadings = liveReadings.filter(r => r.dbh_cm && r.measurement_type === 'dbh')
  const anomalies = liveReadings.filter(r => r.is_anomaly)

  return (
    <div className="p-8 max-w-[1400px]">
      {/* Header */}
      <div className="mb-6 flex items-start justify-between flex-wrap gap-4">
        <div>
          <div className="flex items-center gap-2 text-sm text-gray-500 mb-1">
            <ClipboardList className="w-4 h-4" />
            <span>VVB Field Verification</span>
            <ChevronRight className="w-3 h-3" />
            <span>บันทึกผลการวัดภาคสนาม</span>
          </div>
          <h1 className="text-3xl font-bold text-[#1F3D2E] flex items-center gap-3">
            Field Measurement Log
            {selectedProject && isLive && (
              <span className="flex items-center gap-1.5 text-sm font-semibold bg-green-100 text-green-700 px-3 py-1 rounded-full border border-green-300">
                <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse inline-block" />
                LIVE — รับข้อมูล ESP32
              </span>
            )}
          </h1>
          <p className="text-gray-500 mt-1">รับข้อมูลจาก ESP32 แบบ Real-time + บันทึกด้วยตนเองได้</p>
          {lastUpdated && (
            <p className="text-xs text-gray-400 mt-0.5">
              อัปเดต: {lastUpdated.toLocaleTimeString('th-TH')}
              {isLive && selectedProject && <span className="ml-2 text-green-500">• รีเฟรชใน {countdown}s</span>}
            </p>
          )}
        </div>

        <div className="flex gap-2 flex-wrap">
          <button
            onClick={() => setShowManual(true)}
            className="flex items-center gap-2 bg-[#1F3D2E] text-white px-4 py-2.5 rounded-xl text-sm font-semibold hover:bg-[#2C5F2D] transition-colors"
          >
            <Ruler className="w-4 h-4" />
            บันทึกด้วยตนเอง
          </button>
        </div>
      </div>

      {/* Project Selector + controls */}
      <div className="flex gap-3 mb-6 flex-wrap items-center">
        <select
          className="px-4 py-2.5 rounded-xl border border-gray-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-green-500 min-w-[280px]"
          value={selectedProject || ''}
          onChange={e => setSelectedProject(e.target.value ? parseInt(e.target.value) : null)}
        >
          <option value="">เลือกโครงการที่ต้องการตรวจสอบ</option>
          {projects.map(p => <option key={p.id} value={p.id}>{p.name_th || p.name}</option>)}
        </select>

        {selectedProject && (
          <>
            <button
              onClick={() => setIsLive(l => !l)}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-xl border text-sm font-medium transition-colors ${
                isLive ? 'bg-green-600 text-white border-green-600' : 'bg-white text-gray-600 border-gray-200'
              }`}
            >
              {isLive ? <Wifi className="w-4 h-4" /> : <WifiOff className="w-4 h-4" />}
              {isLive ? 'Live ON' : 'Live OFF'}
            </button>
            <button
              onClick={() => fetchReadings(false)}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-gray-200 bg-white text-gray-600 text-sm font-medium hover:border-green-300"
            >
              <RefreshCw className="w-4 h-4" />
              รีเฟรช
            </button>
          </>
        )}
      </div>

      {!selectedProject ? (
        <div className="text-center py-24 text-gray-400">
          <Trees className="w-20 h-20 mx-auto mb-4 text-gray-200" />
          <div className="text-lg font-medium">เลือกโครงการด้านบนเพื่อเริ่มบันทึกผล</div>
          <div className="text-sm mt-2">ระบบจะรับข้อมูล ESP32 แบบ real-time และแสดงผลในหน้านี้</div>
        </div>
      ) : (
        <>
          {/* Summary Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            {[
              { label: 'วัด DBH แล้ว', value: dbhReadings.length, icon: Activity, color: 'bg-blue-50 border-blue-200' },
              { label: 'วัดความสูงแล้ว', value: heightReadings.length, icon: Trees, color: 'bg-green-50 border-green-200' },
              { label: 'Anomaly พบ', value: anomalies.length, icon: AlertTriangle, color: anomalies.length > 0 ? 'bg-red-50 border-red-200' : 'bg-gray-50 border-gray-200', alert: anomalies.length > 0 },
              { label: 'บันทึกด้วยมือ', value: fieldRecords.length, icon: Ruler, color: 'bg-amber-50 border-amber-200' },
            ].map(s => (
              <div key={s.label} className={`rounded-xl p-4 border flex items-center gap-3 ${s.color}`}>
                <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${s.alert ? 'bg-red-100' : 'bg-white'}`}>
                  <s.icon className={`w-5 h-5 ${s.alert ? 'text-red-600' : 'text-gray-600'}`} />
                </div>
                <div>
                  <div className={`text-2xl font-bold ${s.alert ? 'text-red-700' : 'text-gray-900'}`}>{s.value}</div>
                  <div className="text-xs text-gray-500">{s.label}</div>
                </div>
              </div>
            ))}
          </div>

          {/* ESP32 Setup reminder */}
          <div className="mb-6 bg-[#0d1117] rounded-2xl p-4 flex items-start gap-4">
            <Cpu className="w-5 h-5 text-green-400 mt-0.5 flex-shrink-0" />
            <div>
              <div className="text-white font-semibold text-sm">วิธีใช้ ESP32 วัดความสูง</div>
              <div className="text-gray-400 text-xs mt-1 leading-relaxed">
                Serial Monitor → <span className="text-green-400 font-mono">CAL</span> (calibrate) →{' '}
                <span className="text-green-400 font-mono">SET_D,10.5</span> (ระยะห่าง) →{' '}
                ชี้ที่ยอดต้นไม้ → <span className="text-green-400 font-mono">MEASURE</span> → ข้อมูลขึ้นตารางด้านล่างอัตโนมัติ
              </div>
            </div>
          </div>

          {/* Readings Table */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden mb-6">
            <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
              <span className="font-semibold text-gray-800">ข้อมูลที่รับจาก ESP32 (7 วันล่าสุด)</span>
              <span className="text-xs text-gray-400">{liveReadings.length} รายการ</span>
            </div>
            {liveReadings.length === 0 ? (
              <div className="text-center py-16 text-gray-400">
                <Cpu className="w-12 h-12 mx-auto mb-3 text-gray-200" />
                <div>ยังไม่มีข้อมูล — รอ ESP32 ส่งข้อมูล</div>
                <div className="text-xs mt-1">รันคำสั่ง MEASURE ใน Serial Monitor</div>
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-[#1F3D2E] text-white">
                    {['', 'เวลา', 'Tree ID', 'ประเภท', 'DBH (cm)', 'ความสูง (m)', 'CO₂ (kg)', 'Confidence', 'Tier', 'สถานะ'].map(h => (
                      <th key={h} className="px-4 py-3 text-left text-xs font-semibold">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {liveReadings.slice(0, 100).map((r, i) => {
                    const isNew = newIds.has(r.id)
                    return (
                      <tr key={r.id} className={`transition-all duration-700 ${
                        isNew ? 'bg-green-100' : r.is_anomaly ? 'bg-red-50' : i % 2 === 0 ? 'bg-white' : 'bg-gray-50'
                      } hover:bg-yellow-50`}>
                        <td className="px-3 py-2.5">
                          {isNew && <span className="text-xs font-bold text-green-700 bg-green-200 px-1.5 py-0.5 rounded-full">NEW</span>}
                        </td>
                        <td className="px-4 py-2.5 text-gray-500 text-xs whitespace-nowrap">
                          {new Date(r.timestamp).toLocaleString('th-TH', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                        </td>
                        <td className="px-4 py-2.5 text-gray-600 font-mono text-xs">{r.tree_id ? `T-${r.tree_id}` : '—'}</td>
                        <td className="px-4 py-2.5">
                          <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${r.measurement_type === 'height' ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'}`}>
                            {r.measurement_type === 'height' ? '📏 ความสูง' : '🌳 DBH'}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 font-medium text-gray-900">{r.dbh_cm?.toFixed(1) || '—'}</td>
                        <td className="px-4 py-2.5 font-medium text-green-800">
                          {r.height_m ? `${r.height_m.toFixed(2)} m` : '—'}
                        </td>
                        <td className="px-4 py-2.5 text-green-700 font-medium">{r.co2_kg?.toFixed(1) || '—'}</td>
                        <td className="px-4 py-2.5">
                          <div className={`text-xs font-medium ${(r.confidence_score || 0) >= 80 ? 'text-green-600' : 'text-amber-600'}`}>
                            {r.confidence_score?.toFixed(0)}%
                          </div>
                        </td>
                        <td className="px-4 py-2.5 text-gray-600 text-xs capitalize">{r.tier}</td>
                        <td className="px-4 py-2.5">
                          {r.is_anomaly ? (
                            <div className="group relative">
                              <span className="text-red-600 text-xs font-medium cursor-help">⚠️ anomaly</span>
                              <div className="absolute bottom-full left-0 bg-red-900 text-white text-xs p-2 rounded-lg hidden group-hover:block w-48 z-10">
                                {r.anomaly_reason}
                              </div>
                            </div>
                          ) : <span className="text-green-600 text-xs">✅ ปกติ</span>}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>

          {/* Manual Records */}
          {fieldRecords.length > 0 && (
            <div className="bg-amber-50 rounded-2xl border border-amber-200 overflow-hidden">
              <div className="px-5 py-3 border-b border-amber-200 font-semibold text-amber-800 text-sm">
                📝 บันทึกด้วยตนเองในเซสชันนี้ ({fieldRecords.length} รายการ)
              </div>
              <div className="divide-y divide-amber-100">
                {fieldRecords.map((r, i) => (
                  <div key={i} className="px-5 py-3 flex items-center gap-4 text-sm">
                    <span className="text-amber-700 font-mono text-xs">{new Date(r.timestamp).toLocaleTimeString('th-TH')}</span>
                    <span className="text-gray-700 font-medium">Tree {r.tree_id || '—'}</span>
                    {r.dbh_cm && <span className="bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full text-xs">DBH {r.dbh_cm} cm</span>}
                    {r.height_m && <span className="bg-green-100 text-green-700 px-2 py-0.5 rounded-full text-xs">H {r.height_m} m</span>}
                    {r.note && <span className="text-gray-400 text-xs">{r.note}</span>}
                    <CheckCircle2 className="w-4 h-4 text-green-500 ml-auto" />
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {/* Manual Entry Modal */}
      {showManual && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <h2 className="font-bold text-gray-900 text-lg">บันทึกผลการวัดด้วยตนเอง</h2>
              <button onClick={() => { setShowManual(false); setSubmitResult(null) }} className="text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="text-xs font-medium text-gray-700 mb-1 block">Tree ID (ตัวเลข)</label>
                <input
                  type="number"
                  placeholder="เช่น 5"
                  value={manualForm.tree_id}
                  onChange={e => setManualForm(f => ({ ...f, tree_id: e.target.value }))}
                  className="w-full px-4 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-gray-700 mb-1 block">DBH (cm)</label>
                  <input
                    type="number" step="0.1"
                    placeholder="เช่น 28.5"
                    value={manualForm.dbh_cm}
                    onChange={e => setManualForm(f => ({ ...f, dbh_cm: e.target.value }))}
                    className="w-full px-4 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-700 mb-1 block">ความสูง (m)</label>
                  <input
                    type="number" step="0.01"
                    placeholder="เช่น 8.52"
                    value={manualForm.height_m}
                    onChange={e => setManualForm(f => ({ ...f, height_m: e.target.value }))}
                    className="w-full px-4 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                  />
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-700 mb-1 block">หมายเหตุ (optional)</label>
                <input
                  type="text"
                  placeholder="เช่น วัดซ้ำเพราะค่าผิดปกติ"
                  value={manualForm.note}
                  onChange={e => setManualForm(f => ({ ...f, note: e.target.value }))}
                  className="w-full px-4 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                />
              </div>

              {submitResult && (
                <div className={`rounded-xl px-4 py-3 text-sm font-medium ${submitResult.ok ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
                  {submitResult.ok ? '✅ ' : '❌ '}{submitResult.msg}
                </div>
              )}

              <button
                onClick={handleManualSubmit}
                disabled={submitting || !selectedProject}
                className="w-full py-3 bg-[#1F3D2E] text-white rounded-xl font-semibold text-sm hover:bg-[#2C5F2D] disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
              >
                {submitting ? <RefreshCw className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                {submitting ? 'กำลังบันทึก...' : 'บันทึกและส่งขึ้นระบบ'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
