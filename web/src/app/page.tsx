"use client";

import React, { useState, useEffect, useMemo } from 'react';
import { Search, RotateCcw, ShieldCheck, ListFilter, Hospital, ClipboardList, Tag } from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

// --- 類型定義 ---
interface MedicalProduct {
  医院名稱: string;
  型號: string;
  產品名稱: string;
  健保碼: string;
  院內碼: string;
  批價碼: string;
  原始備註: string;
  搜尋用字串: string;
}

interface Metadata {
  updated_at: string;
  file_name: string;
  record_count: number;
}

// --- 醫院列表 (與 Python 版同步) ---
const PUBLIC_HOSPITALS = [
    "大林慈濟", "中國(祐新/銀鐸)", "中國北港(祐新/銀鐸)", "中國安南(祐新/銀鐸)", "中國新竹(祐新/銀鐸)",
    "中榮", "天主教聖馬爾定醫院", "台南市立(秀傳)", "右昌", "台南新樓", "成大", "秀傳", "阮綜合",
    "奇美永康", "奇美佳里", "奇美柳營", "東港安泰", "枋寮醫院", "屏東榮民總醫院", "屏東寶建", "屏基",
    "高雄大同(長庚)", "高雄小港(高醫)", "高雄市立民生醫院", "高雄市立聯合醫院", "高雄岡山(高醫)",
    "高雄長庚", "高雄榮民總醫院臺南分院", "高榮", "高醫", "健仁", "國軍左營", "國軍高雄",
    "國軍高雄總醫院屏東分院", "郭綜合", "麻豆新樓", "義大", "嘉基", "嘉義長庚", "嘉義陽明",
    "臺南新樓", "輔英(可用彰基院內碼)", "衛生福利部屏東醫院", "衛生福利部恆春旅遊醫院",
    "衛生福利部新營醫院", "衛生福利部嘉義醫院", "衛生福利部旗山醫院", "衛生福利部臺南醫院",
    "衛生福利部澎湖醫院"
];

const MANAGER_HOSPITALS = [
    "新店慈濟", "台北慈濟", "內湖三總", "三軍總醫院", "松山三總", "松山分院", 
    "國立陽明大學", "國立陽明交通大學", "交通大學", "輔大", "羅東博愛", 
    "衛生福利部臺北醫院", "部立臺北"
];

export default function SearchPage() {
  const [data, setData] = useState<MedicalProduct[]>([]);
  const [metadata, setMetadata] = useState<Metadata | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // 搜尋狀態
  const [selectedHospitals, setSelectedHospitals] = useState<string[]>([]);
  const [codeQuery, setCodeQuery] = useState("");
  const [keyQuery, setKeyQuery] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);
  const [adminKey, setAdminKey] = useState("");
  const [showAdminTab, setShowAdminTab] = useState(false);

  // 載入資料
  useEffect(() => {
    fetch('/api/data')
      .then(res => res.json())
      .then(json => {
        if (json.error) throw new Error(json.error);
        setData(json.data || []);
        setMetadata(json.metadata || null);
        setLoading(false);
      })
      .catch(err => {
        console.error(err);
        setLoading(false);
      });
  }, []);

  // 取得當前可見的醫院清單
  const availableHospitals = useMemo(() => {
    const dbHospitals = Array.from(new Set(data.map(item => item.医院名稱)));
    const allowed = isAdmin ? [...PUBLIC_HOSPITALS, ...MANAGER_HOSPITALS] : PUBLIC_HOSPITALS;
    return dbHospitals
      .filter(h => allowed.some(a => h === a || h.includes(a)))
      .sort((a, b) => a.localeCompare(b, "zh-Hant"));
  }, [data, isAdmin]);

  // 執行過濾邏輯
  const filteredData = useMemo(() => {
    if (!data.length) return [];
    
    let result = data;

    // 1. 醫院權限與選擇過濾
    const allowed = isAdmin ? [...PUBLIC_HOSPITALS, ...MANAGER_HOSPITALS] : PUBLIC_HOSPITALS;
    result = result.filter(item => allowed.some(a => item.医院名稱 === a || item.医院名稱.includes(a)));

    if (selectedHospitals.length > 0) {
      result = result.filter(item => selectedHospitals.includes(item.医院名稱));
    }

    // 2. 代碼搜尋
    if (codeQuery) {
      const q = codeQuery.toLowerCase();
      result = result.filter(item => 
        (item.院內碼?.toLowerCase().includes(q)) || 
        (item.批價碼?.toLowerCase().includes(q)) ||
        (item.原始備註?.toLowerCase().includes(q))
      );
    }

    // 3. 關鍵字搜尋 (與 Python 版邏輯一致)
    if (keyQuery) {
      const keys = keyQuery.split(/\s+/).filter(k => k);
      for (const k of keys) {
        const q = k.toLowerCase();
        const q_clean = q.replace(/[^a-zA-Z0-9]/g, '');
        
        result = result.filter(item => {
          const matchNormal = 
            (item.搜尋用字串?.toLowerCase().includes(q)) ||
            (item.原始備註?.toLowerCase().includes(q)) ||
            (item.医院名稱?.toLowerCase().includes(q));
          
          if (q_clean && !matchNormal) {
             return item.搜尋用字串?.toLowerCase().includes(q_clean);
          }
          return matchNormal;
        });
      }
    }

    return result;
  }, [data, selectedHospitals, codeQuery, keyQuery, isAdmin]);

  // 重置
  const handleReset = () => {
    setSelectedHospitals([]);
    setCodeQuery("");
    setKeyQuery("");
  };

  if (loading) return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-earth-bg animate-pulse">
      <div className="w-12 h-12 border-4 border-brand border-t-transparent rounded-full animate-spin mb-4" />
      <p className="text-earth-text/60 font-serif">載入資料庫中...</p>
    </div>
  );

  return (
    <div className="min-h-screen bg-earth-bg flex flex-col md:flex-row font-sans text-earth-text">
      
      {/* --- Sidebar (Desktop) / Header (Mobile) --- */}
      <aside className="w-full md:w-80 lg:w-96 bg-earth-sidebar border-b md:border-b-0 md:border-r border-earth-border overflow-y-auto z-10">
        <div className="p-6 md:p-8 space-y-8">
          <div>
            <h1 className="text-3xl font-serif font-bold text-gray-800 tracking-tight leading-tight">
              院內碼<br />查詢系統
            </h1>
            <p className="mt-2 text-[10px] uppercase tracking-widest text-gray-400 font-medium">
              Medical Product Database
            </p>
          </div>

          {/* Admin Toggle */}
          <div className="pt-2">
            {!isAdmin ? (
               <button 
                onClick={() => setShowAdminTab(!showAdminTab)}
                className="text-xs flex items-center gap-1.5 text-gray-400 hover:text-brand transition-colors"
               >
                 <ShieldCheck size={14} /> {showAdminTab ? "隱藏設定" : "管理員模式"}
               </button>
            ) : (
               <div className="bg-brand/10 px-3 py-1.5 rounded flex items-center justify-between">
                 <span className="text-xs text-brand font-medium flex items-center gap-1.5">
                   <ShieldCheck size={14} /> Admin Mode Enabled
                 </span>
                 <button onClick={() => setIsAdmin(false)} className="text-brand hover:opacity-70 text-xs">退出</button>
               </div>
            )}
            
            {showAdminTab && !isAdmin && (
              <div className="mt-2 flex gap-2">
                <input 
                  type="password" 
                  placeholder="Key" 
                  className="bg-white border text-xs px-2 py-1 flex-1 rounded focus:outline-none focus:border-brand"
                  value={adminKey}
                  onChange={(e) => setAdminKey(e.target.value)}
                />
                <button 
                  onClick={() => { if(adminKey === "163") { setIsAdmin(true); setShowAdminTab(false); } }}
                  className="bg-brand text-white text-xs px-3 py-1 rounded"
                >進入</button>
              </div>
            )}
          </div>

          <div className="space-y-6">
            {/* 醫院選擇 */}
            <div className="space-y-3">
              <label className="text-xs font-serif font-bold text-gray-500 flex items-center gap-2">
                <ListFilter size={14} /> 01. 選擇醫院
              </label>
              <div className="grid grid-cols-1 gap-2">
                <select 
                   className="w-full bg-white border border-earth-border rounded px-3 py-2 text-sm focus:ring-1 focus:ring-brand focus:border-brand outline-none transition-all appearance-none"
                   onChange={(e) => {
                     const val = e.target.value;
                     if (val === "ALL") setSelectedHospitals([]);
                     else setSelectedHospitals([val]);
                   }}
                >
                  <option value="ALL">(所有醫院)</option>
                  {availableHospitals.map(h => (
                    <option key={h} value={h}>{h}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* 代碼輸入 */}
            <div className="space-y-3">
              <label className="text-xs font-serif font-bold text-gray-500 flex items-center gap-2">
                <ClipboardList size={14} /> 02. 輸入代碼
              </label>
              <input 
                type="text" 
                placeholder="院內碼 / 批價碼"
                value={codeQuery}
                onChange={(e) => setCodeQuery(e.target.value)}
                className="w-full bg-white border border-earth-border rounded px-4 py-2 text-sm focus:ring-1 focus:ring-brand focus:border-brand outline-none transition-all"
              />
            </div>

            {/* 關鍵字搜尋 */}
            <div className="space-y-3">
              <label className="text-xs font-serif font-bold text-gray-500 flex items-center gap-2">
                <Tag size={14} /> 03. 關鍵字
              </label>
              <div className="relative">
                <Search className="absolute left-3 top-2.5 text-gray-300" size={16} />
                <input 
                  type="text" 
                  placeholder="型號 / 產品名"
                  value={keyQuery}
                  onChange={(e) => setKeyQuery(e.target.value)}
                  className="w-full bg-white border border-earth-border rounded pl-10 pr-4 py-2 text-sm focus:ring-1 focus:ring-brand focus:border-brand outline-none transition-all"
                />
              </div>
            </div>

            <button 
              onClick={handleReset}
              className="w-full py-2.5 flex items-center justify-center gap-2 text-xs font-serif tracking-widest bg-transparent border border-gray-300 hover:border-brand hover:text-brand transition-all active:scale-[0.98]"
            >
              <RotateCcw size={14} /> RESET ALL
            </button>
          </div>

          {metadata && (
            <div className="pt-8 border-t border-earth-border/50 space-y-1">
              <p className="text-[10px] text-gray-400 font-medium tracking-tight">最後更新: {metadata.updated_at}</p>
              <p className="text-[10px] text-gray-400 font-medium tracking-tight">版本: {metadata.file_name}</p>
            </div>
          )}
        </div>
      </aside>

      {/* --- Main Content --- */}
      <main className="flex-1 overflow-y-auto p-6 md:p-12 lg:p-16 max-w-7xl mx-auto w-full">
        {filteredData.length > 0 ? (
          <div className="space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-700">
            <div className="flex items-center justify-between border-b border-earth-border pb-4">
               <span className="text-sm font-serif text-gray-400 italic">Found {filteredData.length} items</span>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2 gap-6">
              {filteredData.map((item, idx) => (
                <div 
                  key={`${item.院內碼}-${idx}`} 
                  className="bg-white border border-earth-border hover:border-brand/40 transition-all p-6 group relative"
                >
                  <div className="flex flex-col gap-4">
                    <div className="flex justify-between items-start">
                      <div className="space-y-1 flex-1 pr-4">
                        <span className="text-[10px] font-bold text-brand uppercase tracking-widest block">{item.医院名稱}</span>
                        <h3 className="text-lg font-bold text-gray-800 font-serif leading-tight">{item.產品名稱}</h3>
                      </div>
                      {item.院內碼 && (
                        <div className="bg-earth-bg px-3 py-1 border border-earth-border rounded">
                           <span className="text-[10px] text-gray-400 block text-center mb-1">院內碼</span>
                           <span className="text-sm font-mono font-bold text-gray-700">{item.院內碼}</span>
                        </div>
                      )}
                    </div>
                    
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-4 border-t border-earth-border/50">
                      <div>
                        <span className="text-[10px] text-gray-400 block mb-1">規格型號</span>
                        <span className="text-xs font-medium text-gray-600 break-words">{item.型號}</span>
                      </div>
                      {item.健保碼 && (
                        <div>
                          <span className="text-[10px] text-gray-400 block mb-1">健保碼</span>
                          <span className="text-xs font-medium text-gray-600">{item.健保碼}</span>
                        </div>
                      )}
                    </div>

                    {item.批價碼 && (
                      <div className="pt-2">
                        <span className="text-[10px] text-gray-400 block mb-1">批價碼</span>
                        <span className="text-xs font-medium text-gray-600">{item.批價碼}</span>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="h-full flex flex-col items-center justify-center space-y-6 opacity-40 grayscale animate-in fade-in duration-1000">
            <Hospital size={80} strokeWidth={0.5} />
            <div className="text-center space-y-2">
              <h3 className="text-2xl font-serif">NO RESULTS</h3>
              <p className="text-sm font-light">請調整搜尋條件或選擇其他醫院</p>
            </div>
            <div className="w-12 h-px bg-gray-300" />
          </div>
        )}
      </main>
    </div>
  );
}
