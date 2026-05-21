/**
 * SomromScan v2 — ESP32 Field Sensor Node
 * =========================================
 * วัดความสูง 2 ระยะ (5m + 10m) แล้วเฉลี่ยตามโปรโตคอล T-VER
 * สูตร: H = d × tan(θ) + h_instrument
 *
 * Hardware:
 *   JSN-SR04T  TRIG=13, ECHO=12
 *   SHT31      SDA=21, SCL=22 (0x44)
 *   MPU6050    SDA=21, SCL=22 (0x68)
 *
 * Library: MPU6050_light, Adafruit SHT31, Adafruit BusIO, ArduinoJson
 */

#include <Wire.h>
#include <MPU6050_light.h>
#include "Adafruit_SHT31.h"
#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <WebServer.h>

// ============================================================
//  การตั้งค่า
// ============================================================
const char* WIFI_SSID     = "3BB_2.4GHz";
const char* WIFI_PASSWORD = "0955761794";
const char* SERVER_IP     = "192.168.1.86";
const int   SERVER_PORT   = 8000;
const int   PROJECT_ID    = 1;
const int   TREE_ID       = -1;
const char* DEVICE_ID     = "ESP32-FIELD-001";
const int   AUTO_DBH_EVERY_SEC = 30;   // 0 = ปิด

// ============================================================
//  Pin
// ============================================================
#define TRIG_PIN  13
#define ECHO_PIN  12

// ============================================================
//  Objects
// ============================================================
MPU6050        mpu(Wire);
Adafruit_SHT31 sht31;
WebServer      server(80);

// ============================================================
//  State
// ============================================================
float pitch_offset        = 0.0;
float instrument_height_m = 1.50;
bool  mpuReady            = false;
bool  shtReady            = false;
bool  isCalibrated        = false;
bool  autoDBH             = (AUTO_DBH_EVERY_SEC > 0);
unsigned long lastAutoDBH = 0;

// ความสูงที่วัดล่าสุด — เก็บค้างไว้จนกว่าจะวัดใหม่
float last_height_m       = 0.0;   // 0 = ยังไม่เคยวัด
unsigned long height_measured_at = 0;  // millis ที่วัดครั้งล่าสุด

// ผลวัด 2 ระยะ
struct HeightReading {
  float d_m     = 0;   // ระยะห่าง (m)
  float angle   = 0;   // มุมที่วัดได้ (degrees)
  float height  = 0;   // H = d*tan(angle) + h_inst
  bool  done    = false;
};
HeightReading h5, h10;   // วัดที่ 5m และ 10m

// ผล DBH และการส่งล่าสุด
struct LastSent {
  float dbh_cm   = 0;
  float height_m = 0;
  float co2_kg   = 0;
  bool  is_anom  = false;
  bool  hasSent  = false;
} lastSent;

// ============================================================
//  Forward declarations
// ============================================================
void sendToSomromScan(const char* type, float dbh, float height, float conf);
void measureDBHSilent();

// ============================================================
//  Helper — วัดมุมเฉลี่ย N ครั้ง
// ============================================================
float readAngle(int n = 50) {
  float s = 0;
  for (int i = 0; i < n; i++) { mpu.update(); s += mpu.getAngleX(); delay(20); }
  return (s / n) - pitch_offset;
}

// ============================================================
//  Web UI HTML
// ============================================================
String getHTML() {
  float curAngle = 0;
  if (mpuReady) { mpu.update(); curAngle = mpu.getAngleX() - pitch_offset; }
  float tempC = shtReady ? sht31.readTemperature() : 28.0;
  if (isnan(tempC)) tempC = 28.0;

  // คำนวณค่าเฉลี่ย
  float avgH = 0;
  bool  canAvg = h5.done && h10.done;
  if (canAvg) avgH = (h5.height + h10.height) / 2.0;

  String h = "<!DOCTYPE html><html lang='th'><head>";
  h += "<meta charset='UTF-8'><meta name='viewport' content='width=device-width,initial-scale=1,maximum-scale=1'>";
  h += "<title>SomromScan Field</title><style>";
  h += "*{box-sizing:border-box;margin:0;padding:0}";
  h += "body{font-family:-apple-system,BlinkMacSystemFont,sans-serif;background:#0f1a0f;color:#e8f5e9;min-height:100vh}";
  h += ".hdr{background:#1F3D2E;padding:14px 18px;display:flex;align-items:center;gap:10px;position:sticky;top:0;z-index:9}";
  h += ".logo{width:36px;height:36px;background:#97BC62;border-radius:9px;display:flex;align-items:center;justify-content:center;font-size:18px}";
  h += ".t1{font-size:17px;font-weight:700;color:#fff}.t2{font-size:11px;color:#97BC62}";
  h += ".wrap{padding:14px;max-width:460px;margin:0 auto}";
  h += ".card{background:#1a2e1a;border-radius:14px;padding:18px;margin-bottom:12px;border:1px solid #2d4a2d}";
  h += ".ct{font-size:12px;font-weight:700;color:#97BC62;text-transform:uppercase;letter-spacing:.5px;margin-bottom:12px}";
  h += ".pills{display:flex;gap:7px;flex-wrap:wrap;margin-bottom:12px}";
  h += ".pill{padding:4px 11px;border-radius:18px;font-size:11px;font-weight:700}";
  h += ".ok{background:#1a3d1a;color:#4CAF50;border:1px solid #4CAF50}";
  h += ".er{background:#3d1a1a;color:#f44336;border:1px solid #f44336}";
  h += ".inf{background:#1a3a3d;color:#26C6DA;border:1px solid #26C6DA}";
  h += ".ang{text-align:center;padding:18px 0 10px}";
  h += ".ang-big{font-size:58px;font-weight:800;color:#4CAF50;line-height:1}";
  h += ".ang-lbl{font-size:12px;color:#666;margin-top:4px}";
  h += ".bar-bg{width:100%;height:6px;background:#2d4a2d;border-radius:3px;margin-top:12px;overflow:hidden}";
  h += ".bar-fill{height:100%;background:linear-gradient(90deg,#4CAF50,#97BC62);border-radius:3px;transition:width .3s}";
  h += ".il{font-size:12px;color:#999;margin-bottom:5px;display:block}";
  h += "input[type=number]{width:100%;padding:10px 12px;background:#0d1f0d;border:1.5px solid #2d4a2d;border-radius:9px;color:#e8f5e9;font-size:15px;-webkit-appearance:none}";
  h += "input:focus{outline:none;border-color:#4CAF50}";
  h += ".btn{width:100%;padding:14px;border:none;border-radius:12px;font-size:15px;font-weight:700;cursor:pointer;margin-bottom:8px;-webkit-tap-highlight-color:transparent;transition:opacity .15s}";
  h += ".btn:active{opacity:.8}";
  h += ".g{background:linear-gradient(135deg,#2C5F2D,#4CAF50);color:#fff;box-shadow:0 4px 14px rgba(76,175,80,.3)}";
  h += ".b{background:linear-gradient(135deg,#1565C0,#1976D2);color:#fff}";
  h += ".o{background:linear-gradient(135deg,#E65100,#FF6D00);color:#fff}";
  h += ".gy{background:#2d4a2d;color:#97BC62}";
  h += ".pu{background:linear-gradient(135deg,#6A1B9A,#8E24AA);color:#fff;box-shadow:0 4px 14px rgba(142,36,170,.3)}";
  h += ".dist-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:4px}";
  h += ".dist-box{background:#0d1f0d;border-radius:11px;padding:14px;border:2px solid #2d4a2d;text-align:center;transition:border-color .2s}";
  h += ".dist-box.done{border-color:#4CAF50}";
  h += ".dist-label{font-size:13px;font-weight:700;color:#97BC62;margin-bottom:6px}";
  h += ".dist-angle{font-size:11px;color:#555;margin:3px 0}";
  h += ".dist-result{font-size:22px;font-weight:800;color:#4CAF50}";
  h += ".dist-result.pending{font-size:14px;color:#444;font-weight:400}";
  h += ".avg-box{background:#0d3318;border:2px solid #4CAF50;border-radius:14px;padding:18px;margin-bottom:14px;text-align:center}";
  h += ".avg-box.pending{background:#1a1a1a;border-color:#333}";
  h += ".avg-label{font-size:13px;color:#97BC62;margin-bottom:4px;font-weight:600}";
  h += ".avg-val{font-size:48px;font-weight:800;color:#4CAF50;line-height:1}";
  h += ".avg-val.pending{font-size:16px;color:#444;font-weight:400}";
  h += ".avg-sub{font-size:12px;color:#555;margin-top:6px}";
  h += ".rr{display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid rgba(255,255,255,.05)}";
  h += ".rr:last-child{border:none}.rl{font-size:12px;color:#666}.rv{font-size:16px;font-weight:700;color:#4CAF50}";
  h += ".formula{background:#0d1f0d;border-radius:9px;padding:10px 12px;font-family:monospace;font-size:12px;color:#97BC62;margin-top:8px;line-height:1.8}";
  h += ".sw{width:50px;height:26px;border-radius:13px;cursor:pointer;position:relative;border:none;padding:0}";
  h += ".sw-k{width:20px;height:20px;background:#fff;border-radius:50%;position:absolute;top:3px;transition:left .2s}";
  h += ".toggle-wrap{display:flex;align-items:center;justify-content:space-between;margin-bottom:10px}";
  h += ".auto-st{font-size:12px;text-align:center;padding:6px;border-radius:7px}";
  h += ".tip{font-size:11px;color:#333;text-align:center;margin-bottom:20px}";
  h += "@keyframes sp{to{transform:rotate(360deg)}}";
  h += ".sp{display:inline-block;width:14px;height:14px;border:2px solid rgba(255,255,255,.3);border-top-color:#fff;border-radius:50%;animation:sp .7s linear infinite;vertical-align:middle;margin-right:5px}";
  h += "</style></head><body>";

  // Header
  h += "<div class='hdr'><div class='logo'>&#127795;</div>";
  h += "<div><div class='t1'>SomromScan Field</div><div class='t2'>T-VER Height Protocol: H = d&#215;tan(&#952;) + h</div></div></div>";
  h += "<div class='wrap'>";

  // Pills
  h += "<div class='pills'>";
  h += mpuReady     ? "<span class='pill ok'>MPU6050</span>"    : "<span class='pill er'>MPU ไม่พบ</span>";
  h += shtReady     ? "<span class='pill ok'>SHT31</span>"      : "<span class='pill er'>SHT31 ไม่พบ</span>";
  h += isCalibrated ? "<span class='pill inf'>&#10003; CAL</span>" : "<span class='pill er'>ยังไม่ CAL</span>";
  h += "</div>";

  // Live Angle
  h += "<div class='card'><div class='ct'>&#128208; มุมเงยปัจจุบัน (Live)</div>";
  h += "<div class='ang'><div class='ang-big' id='av'>" + String(curAngle, 1) + "&#176;</div>";
  h += "<div class='ang-lbl'>ชี้เครื่องที่ยอดต้นไม้ รอมุมนิ่ง แล้วกดปุ่มวัด</div>";
  float pct = constrain(abs(curAngle) / 90.0 * 100.0, 0, 100);
  h += "<div class='bar-bg'><div class='bar-fill' id='ab' style='width:" + String(pct, 0) + "%'></div></div></div>";
  h += "<div style='text-align:center;font-size:12px;color:#555'>Temp: " + String(tempC, 1) + "&#176;C | h_inst: " + String(instrument_height_m, 2) + " m</div></div>";

  // ===== Height Protocol Section =====
  h += "<div class='card'><div class='ct'>&#128207; วัดความสูง (T-VER Protocol)</div>";

  // Formula reminder
  h += "<div class='formula'>H = d &times; tan(&theta;) + h_instrument<br>";
  if (h5.done)  h += "H&#8325;  = " + String(h5.d_m,1) + " &times; tan(" + String(h5.angle,1) + "&deg;) + " + String(instrument_height_m,2) + " = <b>" + String(h5.height,2) + " m</b><br>";
  if (h10.done) h += "H&#8321;&#8320; = " + String(h10.d_m,1) + " &times; tan(" + String(h10.angle,1) + "&deg;) + " + String(instrument_height_m,2) + " = <b>" + String(h10.height,2) + " m</b>";
  h += "</div>";

  // Settings
  h += "<div style='margin:12px 0 10px'><label class='il'>ความสูงถือเครื่อง h_instrument (m)</label>";
  h += "<input type='number' step='0.01' min='0.5' max='2.5' value='" + String(instrument_height_m, 2) + "' onchange='setH(this.value)'></div>";

  // 2 distance boxes
  h += "<div class='dist-grid'>";

  // 5m box
  h += String("<div class='dist-box") + (h5.done ? " done" : "") + "'>";
  h += "<div class='dist-label'>&#128207; ระยะ 5 m</div>";
  if (h5.done) {
    h += "<div class='dist-angle'>&#952; = " + String(h5.angle, 1) + "&#176;</div>";
    h += "<div class='dist-result'>" + String(h5.height, 2) + " m</div>";
  } else {
    h += "<div class='dist-result pending'>ยังไม่วัด</div>";
  }
  h += "<button class='btn b' style='margin-top:10px;padding:10px;font-size:13px' onclick='go(\"/m5\")'>ยืน 5m &#8594; วัด</button>";
  h += "</div>";

  // 10m box
  h += String("<div class='dist-box") + (h10.done ? " done" : "") + "'>";
  h += "<div class='dist-label'>&#128207; ระยะ 10 m</div>";
  if (h10.done) {
    h += "<div class='dist-angle'>&#952; = " + String(h10.angle, 1) + "&#176;</div>";
    h += "<div class='dist-result'>" + String(h10.height, 2) + " m</div>";
  } else {
    h += "<div class='dist-result pending'>ยังไม่วัด</div>";
  }
  h += "<button class='btn b' style='margin-top:10px;padding:10px;font-size:13px' onclick='go(\"/m10\")'>ยืน 10m &#8594; วัด</button>";
  h += "</div></div>"; // end grid

  // Average result
  h += "<div style='margin-top:12px'>";
  if (canAvg) {
    h += "<div class='avg-box'><div class='avg-label'>ความสูงเฉลี่ย (H&#8325; + H&#8321;&#8320;) &#247; 2</div>";
    h += "<div class='avg-val'>" + String(avgH, 2) + " m</div>";
    h += "<div class='avg-sub'>&#952;&#8325;=" + String(h5.angle,1) + "&#176; + &#952;&#8321;&#8320;=" + String(h10.angle,1) + "&#176;</div></div>";
    h += "<button class='btn pu' onclick='go(\"/send_height\")'>&#9989; ส่งค่าเฉลี่ยขึ้น SomromScan</button>";
  } else {
    h += "<div class='avg-box pending'><div class='avg-label' style='color:#555'>รอวัดให้ครบทั้ง 2 ระยะ</div>";
    h += "<div class='avg-val pending'>วัด 5m และ 10m ก่อน</div></div>";
  }
  h += "<button class='btn gy' onclick='go(\"/reset_h\")'>&#8635; ล้างค่าความสูง</button>";
  h += "</div></div>"; // end card

  // DBH Section
  h += "<div class='card'><div class='ct'>&#127795; วัด DBH</div>";
  h += "<button class='btn g' onclick='go(\"/dbh\")'>&#127795; วัด DBH + ส่งเว็บ</button>";
  if (lastSent.hasSent && lastSent.dbh_cm > 0) {
    h += "<div class='rr'><span class='rl'>DBH ล่าสุด</span><span class='rv'>" + String(lastSent.dbh_cm,1) + " cm</span></div>";
    h += "<div class='rr'><span class='rl'>CO&#8322;</span><span class='rv'>" + String(lastSent.co2_kg,1) + " kg</span></div>";
  }
  h += "</div>";

  // Calibrate + Auto DBH
  h += "<div class='card'><div class='ct'>&#9881; ตั้งค่าระบบ</div>";
  h += "<button class='btn o' onclick='go(\"/cal\")'>&#128295; Calibrate MPU6050 (วางราบก่อน)</button>";
  String swBg  = autoDBH ? "#4CAF50" : "#444";
  String knobL = autoDBH ? "27px" : "3px";
  String stBg  = autoDBH ? "#0d3318" : "#1a1a1a";
  String stCol = autoDBH ? "#4CAF50" : "#555";
  h += "<div class='toggle-wrap'><div><div style='font-size:14px;font-weight:600'>Auto DBH</div>";
  h += "<div style='font-size:11px;color:#555'>ส่งขึ้นเว็บทุก " + String(AUTO_DBH_EVERY_SEC) + " วิ (Farmer Mode)</div></div>";
  h += "<button class='sw' id='sw' style='background:" + swBg + "' onclick='tog()'>";
  h += "<div class='sw-k' id='kn' style='left:" + knobL + "'></div></button></div>";
  h += "<div class='auto-st' id='ast' style='background:" + stBg + ";color:" + stCol + "'>";
  h += autoDBH ? "&#128994; Auto ON" : "&#9899; Auto OFF";
  h += "</div></div>";

  h += "<div class='tip'>IP: " + WiFi.localIP().toString() + " | Project: " + String(PROJECT_ID) + "</div>";
  h += "</div>";

  // JS
  h += "<script>";
  h += "setInterval(()=>{fetch('/angle').then(r=>r.text()).then(a=>{";
  h += "document.getElementById('av').textContent=a+'°';";
  h += "var p=Math.min(Math.abs(parseFloat(a))/90*100,100);";
  h += "document.getElementById('ab').style.width=p+'%';";
  h += "}).catch(()=>{})},1000);";
  h += "function go(u){";
  h += "document.querySelectorAll('.btn').forEach(b=>{b.disabled=true;b.innerHTML='<span class=sp></span>กำลังวัด...'});";
  h += "fetch(u).then(()=>setTimeout(()=>location.reload(),900)).catch(()=>location.reload());}";
  h += "function setH(v){fetch('/set?hh='+v)}";
  h += "var _on=" + String(autoDBH ? "true" : "false") + ";";
  h += "function tog(){fetch('/atog').then(r=>r.text()).then(s=>{_on=(s==='1');";
  h += "document.getElementById('sw').style.background=_on?'#4CAF50':'#444';";
  h += "document.getElementById('kn').style.left=_on?'27px':'3px';";
  h += "var a=document.getElementById('ast');";
  h += "a.style.background=_on?'#0d3318':'#1a1a1a';a.style.color=_on?'#4CAF50':'#555';";
  h += "a.innerHTML=_on?'&#128994; Auto ON':'&#9899; Auto OFF';});}";
  h += "</script></body></html>";
  return h;
}

// ============================================================
//  Measure height at given distance
// ============================================================
void measureAt(float d_m, HeightReading& slot) {
  if (!mpuReady || !isCalibrated) return;
  float ang = readAngle(60);
  float H   = d_m * tan(ang * PI / 180.0) + instrument_height_m;
  slot.d_m    = d_m;
  slot.angle  = ang;
  slot.height = H;
  slot.done   = true;
  Serial.printf("[HEIGHT] d=%.1fm θ=%.1f° H=%.2fm\n", d_m, ang, H);
}

// ============================================================
//  Route Handlers
// ============================================================
void handleRoot()   { server.send(200, "text/html; charset=utf-8", getHTML()); }
void handleAngle()  {
  if (mpuReady) { mpu.update(); server.send(200,"text/plain",String(mpu.getAngleX()-pitch_offset,1)); }
  else server.send(200,"text/plain","0.0");
}
void handleSet() {
  if (server.hasArg("hh")) instrument_height_m = server.arg("hh").toFloat();
  server.send(200,"text/plain","ok");
}
void handleCal() {
  if (!mpuReady) { server.send(500,"text/plain","no MPU"); return; }
  mpu.calcOffsets(true,true);
  float s=0;
  for(int i=0;i<80;i++){ mpu.update(); s+=mpu.getAngleX(); delay(12); }
  pitch_offset = s/80.0;
  isCalibrated = true;
  Serial.printf("[CAL] offset=%.3f\n",pitch_offset);
  server.send(200,"text/plain","ok");
}
void handleM5()    { measureAt(5.0,  h5);  server.send(200,"text/plain","ok"); }
void handleM10()   { measureAt(10.0, h10); server.send(200,"text/plain","ok"); }
void handleResetH(){ h5={};  h10={}; server.send(200,"text/plain","ok"); }

void handleSendHeight() {
  if (!h5.done || !h10.done) { server.send(400,"text/plain","not ready"); return; }
  float avg = (h5.height + h10.height) / 2.0;
  // บันทึกความสูงค้างไว้ — ใช้กับทุก DBH reading ต่อจากนี้
  last_height_m      = avg;
  height_measured_at = millis();
  Serial.printf("[HEIGHT] เก็บค่า last_height=%.2fm (จะใช้กับ DBH ทุกครั้ง)\n", avg);
  if (WiFi.status()==WL_CONNECTED) sendToSomromScan("height", -1, avg, 95);
  server.send(200,"text/plain","ok");
}

void handleDBH() {
  float tC = shtReady?sht31.readTemperature():28.0;
  if(isnan(tC)) tC=28.0;
  float spd=(331.3+0.606*tC)*100.0/1e6;
  digitalWrite(TRIG_PIN,LOW); delayMicroseconds(5);
  digitalWrite(TRIG_PIN,HIGH); delayMicroseconds(20);
  digitalWrite(TRIG_PIN,LOW);
  long d=pulseIn(ECHO_PIN,HIGH,30000);
  if(d==0){server.send(200,"text/plain","no echo");return;}
  float dbh=(d/2.0)*spd;
  // แนบ last_height_m เสมอ → backend ใช้ Chave 2014 ได้
  float h = (last_height_m > 0) ? last_height_m : -1;
  if(dbh>0.5&&dbh<200&&WiFi.status()==WL_CONNECTED) sendToSomromScan("dbh",dbh,h,90);
  server.send(200,"text/plain","ok");
}

void handleAutoToggle() {
  autoDBH = !autoDBH; lastAutoDBH=0;
  server.send(200,"text/plain",autoDBH?"1":"0");
}

// ============================================================
//  Silent Auto DBH
// ============================================================
void measureDBHSilent() {
  float tC = shtReady?sht31.readTemperature():28.0;
  if(isnan(tC)) tC=28.0;
  float spd=(331.3+0.606*tC)*100.0/1e6;
  digitalWrite(TRIG_PIN,LOW); delayMicroseconds(5);
  digitalWrite(TRIG_PIN,HIGH); delayMicroseconds(20);
  digitalWrite(TRIG_PIN,LOW);
  long d=pulseIn(ECHO_PIN,HIGH,30000);
  if(d==0){Serial.println("[AUTO] no echo");return;}
  float dbh=(d/2.0)*spd;
  if(dbh<0.5||dbh>200){return;}
  // แนบ last_height_m เสมอ → Chave 2014
  float h = (last_height_m > 0) ? last_height_m : -1;
  if(h > 0)
    Serial.printf("[AUTO] DBH=%.1fcm H=%.2fm(cached) → Chave2014\n", dbh, h);
  else
    Serial.printf("[AUTO] DBH=%.1fcm (ยังไม่มีความสูง → Brown1997)\n", dbh);
  if(WiFi.status()==WL_CONNECTED) sendToSomromScan("dbh",dbh,h,88);
}

// ============================================================
//  Send to SomromScan
// ============================================================
void sendToSomromScan(const char* type, float dbh, float height, float conf) {
  HTTPClient http;
  http.begin(String("http://")+SERVER_IP+":"+SERVER_PORT+"/api/sensors");
  http.addHeader("Content-Type","application/json");
  http.setTimeout(8000);
  StaticJsonDocument<512> doc;
  doc["project_id"]       = PROJECT_ID;
  if(TREE_ID>0) doc["tree_id"]=TREE_ID;
  doc["measurement_type"] = type;
  doc["tier"]             = "esp32";
  doc["confidence_score"] = round(conf);
  doc["device_id"]        = DEVICE_ID;
  if(dbh>0)    doc["dbh_cm"]   = round(dbh*10)/10.0;
  if(height>0) doc["height_m"] = round(height*100)/100.0;
  // raw_data สำหรับ height
  if(height>0 && h5.done && h10.done) {
    JsonObject raw = doc.createNestedObject("raw_data");
    raw["h_5m"]    = round(h5.height*100)/100.0;
    raw["h_10m"]   = round(h10.height*100)/100.0;
    raw["angle_5m"]  = round(h5.angle*10)/10.0;
    raw["angle_10m"] = round(h10.angle*10)/10.0;
    raw["h_inst"]  = instrument_height_m;
  }
  String body; serializeJson(doc,body);
  int code=http.POST(body);
  if(code==200||code==201){
    StaticJsonDocument<512> r;
    deserializeJson(r,http.getString());
    lastSent.co2_kg   = r["co2_kg"]   |0.0f;
    lastSent.is_anom  = r["is_anomaly"]|false;
    lastSent.hasSent  = true;
    if(dbh>0)    lastSent.dbh_cm   = dbh;
    if(height>0) lastSent.height_m = height;
    Serial.printf("[OK] ID=%d CO2=%.1f anom=%d\n",(int)(r["id"]|0),lastSent.co2_kg,(int)lastSent.is_anom);
  } else {
    Serial.printf("[ERR] HTTP %d\n",code);
  }
  http.end();
}

// ============================================================
//  Setup
// ============================================================
void setup() {
  Serial.begin(115200); delay(500);
  Serial.println("\n=== SomromScan Field Node v5.0 ===");
  Serial.println("สูตร: H = d x tan(θ) + h_instrument");

  pinMode(TRIG_PIN,OUTPUT); pinMode(ECHO_PIN,INPUT);
  Wire.begin();
  if(sht31.begin(0x44)) { shtReady=true;  Serial.println("[SHT31]   OK"); }
  if(mpu.begin()==0)    { mpuReady=true;  Serial.println("[MPU6050] OK"); }

  WiFi.mode(WIFI_STA); WiFi.begin(WIFI_SSID,WIFI_PASSWORD);
  Serial.print("[WIFI] Connecting");
  while(WiFi.status()!=WL_CONNECTED){delay(500);Serial.print(".");}
  Serial.println("\n========================================");
  Serial.println("  http://" + WiFi.localIP().toString());
  Serial.println("========================================");

  server.on("/",           handleRoot);
  server.on("/angle",      handleAngle);
  server.on("/set",        handleSet);
  server.on("/cal",        handleCal);
  server.on("/m5",         handleM5);
  server.on("/m10",        handleM10);
  server.on("/reset_h",    handleResetH);
  server.on("/send_height",handleSendHeight);
  server.on("/dbh",        handleDBH);
  server.on("/atog",       handleAutoToggle);
  server.begin();
  Serial.println("[WEB] Ready");
}

// ============================================================
//  Loop
// ============================================================
void loop() {
  server.handleClient();
  if(mpuReady) mpu.update();
  if(autoDBH && AUTO_DBH_EVERY_SEC>0) {
    if(millis()-lastAutoDBH >= (unsigned long)AUTO_DBH_EVERY_SEC*1000) {
      lastAutoDBH=millis();
      measureDBHSilent();
    }
  }
}
