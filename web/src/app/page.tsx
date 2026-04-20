"use client";

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Search, RotateCcw, ShieldCheck, ListFilter, Hospital, ClipboardList, Tag, LayoutGrid, List, Download, Upload, Loader2, X, Folder, ChevronDown, ChevronRight, Layers } from 'lucide-react';
import * as XLSX from 'xlsx';
import { useRouter } from 'next/navigation';

// --- 類型定義 ---
interface MedicalProduct {
  醫院名稱: string;
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

// --- 醫院列表 ---
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

// 模糊匹配工具
const matchesHospital = (target: string, allowedList: string[]) => {
    if (!target) return false;
    const cleanTarget = target.replace(/\s+/g, '').toLowerCase();
    return allowedList.some(a => {
        const cleanA = a.replace(/\s+/g, '').toLowerCase();
        return cleanTarget.includes(cleanA) || cleanA.includes(cleanTarget);
    });
};

export default function SearchPage() {
  const router = useRouter();

  const [data, setData] = useState<MedicalProduct[]>([]);
  const [metadata, setMetadata] = useState<Metadata | null>(null);
  const [loading, setLoading] = useState(true);
  
  // 搜尋狀態
  const [selectedHospitals, setSelectedHospitals] = useState<string[]>([]);
  const [codeQuery, setCodeQuery] = useState("");
  const [keyQuery, setKeyQuery] = useState("");
  
  // 權限狀態
  const [isAdmin, setIsAdmin] = useState(false); // 197 管理員
  const [adminChecked, setAdminChecked] = useState(false);
  const [adminKey, setAdminKey] = useState("");

  // 顯示控制
  const [displayMode, setDisplayMode] = useState<'card' | 'accordion'>('card');
  const [selectionMode, setSelectionMode] = useState<'single' | 'multiple'>('single');
  const [hasSearched, setHasSearched] = useState(false);
  const [expandedHospitals, setExpandedHospitals] = useState<Record<string, boolean>>({});

  // 載入資料
  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = () => {
    setLoading(true);
    // 加入傳參避免快取
    fetch(`/api/data?t=${Date.now()}`)
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
  };

  // 權限過濾：管理員看全體，其餘看南區 (公開)
  const allowedHospitals = useMemo(() => {
      // 197 管理員
      if (isAdmin) return [...PUBLIC_HOSPITALS, ...MANAGER_HOSPITALS];
      // 預設 (公開)
      return PUBLIC_HOSPITALS;
  }, [isAdmin]);

  // 取得當前可見醫院清單
  const availableHospitals = useMemo(() => {
    const dbHospitals = Array.from(new Set(data.map(item => item.醫院名稱)));
    return dbHospitals
      .filter(h => matchesHospital(h, allowedHospitals))
      .sort((a, b) => a.localeCompare(b, "zh-Hant"));
  }, [data, allowedHospitals]);

  // 執行過濾邏輯
  const filteredData = useMemo(() => {
    if (!data.length) return [];
    
    // 只有在搜尋模式下才執行完整過濾，否則回傳空 (由 Welcome 畫面覆蓋)
    // 但為了下載功能，我們還是要保留邏輯，只是顯示層控制 hasSearched
    let result = data;

    // 1. 權限過濾
    result = result.filter(item => matchesHospital(item.醫院名稱, allowedHospitals));

    // 2. 選擇醫院
    if (selectedHospitals.length > 0) {
      result = result.filter(item => selectedHospitals.includes(item.醫院名稱));
    }

    // 3. 代碼搜尋
    if (codeQuery) {
      const q = codeQuery.toLowerCase().trim();
      result = result.filter(item => 
        (item.院內碼?.toLowerCase().includes(q)) || 
        (item.批價碼?.toLowerCase().includes(q)) ||
        (item.原始備註?.toLowerCase().includes(q))
      );
    }

    // 4. 關鍵字搜尋
    if (keyQuery) {
      const keys = keyQuery.split(/\s+/).filter(k => k);
      for (const k of keys) {
        const q = k.toLowerCase().trim();
        const q_clean = q.replace(/[^a-zA-Z0-9]/g, '');
        
        result = result.filter(item => {
          const matchNormal = 
            (item.搜尋用字串?.toLowerCase().includes(q)) ||
            (item.原始備註?.toLowerCase().includes(q)) ||
            (item.醫院名稱?.toLowerCase().includes(q));
          
          if (q_clean && !matchNormal) {
             return item.搜尋用字串?.toLowerCase().includes(q_clean);
          }
          return matchNormal;
        });
      }
    }

    return result;
  }, [data, selectedHospitals, codeQuery, keyQuery, allowedHospitals]);

  // 手動觸發搜尋 (解決首頁自動跑出院內碼的問題)
  const handleSearchSubmit = () => {
      setHasSearched(true);
      // 自動展開只有一間醫院時的群組
      const hospSet = new Set(filteredData.map(d => d.醫院名稱));
      if (hospSet.size === 1) {
          const hosp = Array.from(hospSet)[0];
          setExpandedHospitals({ [hosp]: true });
      }
  };

  // 重置
  const handleReset = () => {
    setSelectedHospitals([]);
    setCodeQuery("");
    setKeyQuery("");
    setHasSearched(false);
  };

  // 管理員登入 (197)
  const handleLogin = () => {
      const key = adminKey.trim();
      if (key === "197") {
          setIsAdmin(true);
          setAdminChecked(false);
          setAdminKey("");
          router.push('/admin');
      } else if (key === "163") {
          alert("主管模式暫時停用，進行系統維護中。請輸入管理員密碼進行更新。");
      } else {
          alert("密碼無效，請輸入正確的管理員密碼");
      }
  };

  // 匯出功能
  const handleExport = (format: 'csv' | 'xlsx') => {
      if (filteredData.length === 0) return;
      const exportData = filteredData.map(item => ({
          '醫院名稱': item.醫院名稱, '產品名稱': item.產品名稱, '型號': item.型號, '院內碼': item.院內碼, '批價碼': item.批價碼, '健保碼': item.健保碼 || '', '備註': item.原始備註
      }));
      const ws = XLSX.utils.json_to_sheet(exportData);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "院內碼結果");
      if (format === 'xlsx') XLSX.writeFile(wb, `院內碼匯出_${new Date().toISOString().slice(0, 10)}.xlsx`);
      else XLSX.writeFile(wb, `院內碼匯出_${new Date().toISOString().slice(0, 10)}.csv`, { bookType: 'csv' });
  };

  if (loading) return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-earth-bg">
      <div className="w-12 h-12 border-4 border-brand border-t-transparent rounded-full animate-spin mb-4" />
      <p className="text-earth-text/60 font-serif">系統同步中...</p>
    </div>
  );

  return (
    <div className="min-h-screen bg-earth-bg flex flex-col md:flex-row font-sans text-earth-text">
      
      {/* --- Sidebar (左側面板) --- */}
      <aside className="w-full md:w-80 lg:w-96 bg-earth-sidebar border-b md:border-b-0 md:border-r border-earth-border overflow-y-auto z-10">
        <div className="p-6 md:p-8 space-y-6">
          <div className="space-y-1">
            <h2 className="text-xl font-bold flex items-center gap-2 text-gray-700">
               <span className="bg-yellow-400 p-1 rounded text-white shadow-sm"><Folder size={18} /></span> 查詢目錄
            </h2>
            {metadata && (
                <div className="text-[10px] text-gray-400 font-medium">
                  <p>最後更新：{metadata.updated_at}</p>
                  <p>版次：{metadata.file_name}</p>
                </div>
            )}
          </div>

          <hr className="border-earth-border/50" />

          {/* Admin Toggle */}
          <div className="space-y-3">
             <div className="flex items-center gap-2">
                <input 
                  type="checkbox" 
                  id="admin-check"
                  checked={adminChecked || isAdmin}
                  onChange={(e) => {
                      if (!isAdmin) setAdminChecked(e.target.checked);
                      else { setIsAdmin(false); setAdminChecked(false); }
                  }}
                  className="w-4 h-4 rounded border-gray-300 text-brand focus:ring-brand"
                />
                <label htmlFor="admin-check" className="text-sm text-gray-500 cursor-pointer">Admin 登入</label>
             </div>
             {(adminChecked && !isAdmin) && (
                 <div className="flex gap-2 animate-in slide-in-from-top-2 duration-300">
                    <input 
                      type="password" 
                      placeholder="Password" 
                      value={adminKey}
                      onChange={(e) => setAdminKey(e.target.value)}
                      onKeyPress={(e) => e.key === 'Enter' && handleLogin()}
                      className="bg-white border text-xs px-2 py-1.5 flex-1 rounded focus:border-brand shadow-sm outline-none"
                    />
                    <button onClick={handleLogin} className="bg-brand text-white text-xs px-3 py-1.5 rounded hover:opacity-90 transition-all font-bold shadow-sm">進入</button>
                 </div>
             )}
             {isAdmin && (
                 <div className="bg-green-600/10 border border-green-600/20 px-3 py-2 rounded flex items-center justify-between animate-in zoom-in-95 shadow-sm">
                     <span className="text-xs text-green-700 font-bold flex items-center gap-1.5">
                        <ShieldCheck size={14} /> Admin Mode
                     </span>
                     <button onClick={() => { setIsAdmin(false); }} className="text-green-700 hover:scale-110 text-xs font-black transition-transform">退出</button>
                 </div>
             )}
          </div>

          <div className="space-y-4">
             <div className="space-y-2">
                <label className="text-xs text-gray-400 font-medium">顯示設定</label>
                <div className="flex gap-4">
                   <label className="flex items-center gap-1.5 cursor-pointer">
                      <input type="radio" checked={selectionMode === 'single'} onChange={() => setSelectionMode('single')} className="text-brand focus:ring-brand" />
                      <span className="text-xs">單選</span>
                   </label>
                   <label className="flex items-center gap-1.5 cursor-pointer">
                      <input type="radio" checked={selectionMode === 'multiple'} onChange={() => setSelectionMode('multiple')} className="text-brand focus:ring-brand" />
                      <span className="text-xs">多選</span>
                   </label>
                </div>
             </div>

             {/* 搜尋條件區塊 */}
             <div className="bg-[#f2f2ef] p-6 rounded-lg border border-earth-border/40 space-y-6 shadow-inner">
                <div className="space-y-3">
                    <label className="text-xs font-bold text-gray-600">01. 選擇醫院</label>
                    {selectionMode === 'single' ? (
                        <select 
                            className="w-full bg-white border border-earth-border rounded px-3 py-2.5 text-sm focus:ring-1 focus:ring-brand outline-none shadow-sm"
                            value={selectedHospitals[0] || "ALL"}
                            onChange={(e) => { 
                                setSelectedHospitals(e.target.value === "ALL" ? [] : [e.target.value]); 
                                // 注意：這裡取消自動 trigger，必須點按鈕才搜尋
                            }}
                        >
                            <option value="ALL">(所有醫院)</option>
                            {availableHospitals.map(h => <option key={h} value={h}>{h}</option>)}
                        </select>
                    ) : (
                        <div className="space-y-2 max-h-48 overflow-y-auto pr-2 custom-scrollbar bg-white p-3 rounded border border-earth-border shadow-inner">
                           {availableHospitals.map(h => (
                               <label key={h} className="flex items-center gap-2 cursor-pointer py-1 hover:bg-gray-50 transition-colors">
                                  <input 
                                    type="checkbox" 
                                    checked={selectedHospitals.includes(h)} 
                                    onChange={(e) => {
                                        const next = e.target.checked ? [...selectedHospitals, h] : selectedHospitals.filter(x => x !== h);
                                        setSelectedHospitals(next);
                                    }}
                                    className="rounded border-gray-300 text-brand focus:ring-brand" 
                                  />
                                  <span className="text-xs truncate">{h}</span>
                               </label>
                           ))}
                        </div>
                    )}
                </div>

                <div className="space-y-3">
                    <label className="text-xs font-bold text-gray-600">02. 輸入代碼</label>
                    <input 
                        type="text" placeholder="院內碼 / 批價碼" value={codeQuery}
                        onChange={(e) => setCodeQuery(e.target.value)}
                        onKeyPress={(e) => e.key === 'Enter' && handleSearchSubmit()}
                        className="w-full bg-white border border-earth-border rounded px-3 py-2 text-sm focus:border-brand outline-none shadow-sm"
                    />
                </div>

                <div className="space-y-3">
                    <label className="text-xs font-bold text-gray-600">03. 關鍵字</label>
                    <input 
                        type="text" placeholder="型號 / 產品名" value={keyQuery}
                        onChange={(e) => setKeyQuery(e.target.value)}
                        onKeyPress={(e) => e.key === 'Enter' && handleSearchSubmit()}
                        className="w-full bg-white border border-earth-border rounded px-3 py-2 text-sm focus:border-brand outline-none shadow-sm"
                    />
                </div>

                <div className="flex gap-2 pt-2">
                    <button onClick={handleSearchSubmit} className="flex-1 py-2 bg-brand text-white rounded text-xs font-bold shadow hover:opacity-90 active:scale-95 transition-all">SEARCH</button>
                    <button onClick={handleReset} className="flex-1 py-2 border border-gray-300 rounded text-xs text-gray-600 hover:bg-gray-100 transition-all font-bold">RESET</button>
                </div>
             </div>

             {/* 197 管理員介面 */}
             {isAdmin && (
                  <div className="pt-6 border-t border-earth-border border-dashed space-y-4 animate-in slide-in-from-bottom-4 duration-500">
                      <button onClick={() => router.push('/admin')} className="w-full py-3 bg-brand text-white rounded-lg flex items-center justify-center gap-2 hover:bg-brand/90 transition-all shadow-sm font-bold text-sm tracking-wide">
                          前往資料庫後台管理 ➜
                      </button>
                  </div>
             )}
          </div>
        </div>
      </aside>

      {/* --- Main Content --- */}
      <main className="flex-1 overflow-y-auto w-full p-6 md:p-12 lg:p-16">
        <div className="max-w-6xl mx-auto space-y-12">
            
            {/* Header */}
            <header className="text-center space-y-3">
                <h1 className="text-4xl md:text-5xl font-serif font-bold text-gray-800 tracking-tight">
                    院內碼查詢系統 <span className="text-[10px] text-brand font-sans align-top opacity-60">v1.5 (Admin Fix)</span>
                </h1>
                <hr className="w-full border-t-2 border-brand/30 max-w-xs mx-auto shadow-sm" />
                <p className="text-xs uppercase tracking-[0.3em] text-gray-400 font-black pt-2">Medical Product Database</p>
            </header>

            {hasSearched ? (
              <div className="space-y-8 animate-in fade-in slide-in-from-right-4 duration-700">
                <div className="flex flex-col sm:flex-row items-center justify-between gap-4 border-b border-earth-border pb-6">
                   <div className="flex items-center gap-3">
                       <ShieldCheck className="text-brand" size={20} />
                       <span className="text-sm font-serif text-gray-500 italic">找到 {filteredData.length} 筆相符資料</span>
                   </div>
                   <div className="flex items-center gap-4">
                      <div className="flex bg-white border border-earth-border rounded-lg p-1 shadow-sm">
                          <button onClick={() => setDisplayMode('card')} className={`p-1.5 rounded-md transition-all ${displayMode === 'card' ? 'bg-brand text-white shadow' : 'text-gray-400 hover:text-gray-600'}`}><LayoutGrid size={16} /></button>
                          <button onClick={() => setDisplayMode('accordion')} className={`p-1.5 rounded-md transition-all ${displayMode === 'accordion' ? 'bg-brand text-white shadow' : 'text-gray-400 hover:text-gray-600'}`}><Layers size={16} /></button>
                      </div>
                      <div className="flex gap-2">
                          <button onClick={() => handleExport('csv')} className="px-3 py-1.5 bg-white border border-earth-border rounded-lg text-[10px] font-black text-gray-600 hover:border-brand hover:text-brand transition-all shadow-sm flex items-center gap-1.5 uppercase">CSV</button>
                          <button onClick={() => handleExport('xlsx')} className="px-3 py-1.5 bg-white border border-earth-border rounded-lg text-[10px] font-black text-gray-600 hover:border-brand hover:text-brand transition-all shadow-sm flex items-center gap-1.5 uppercase">Excel</button>
                      </div>
                   </div>
                </div>
                
                {filteredData.length > 0 ? (
                    displayMode === 'card' ? (
                      <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">
                        {filteredData.map((item, idx) => (
                          <div key={idx} className="bg-white border border-earth-border shadow-sm hover:shadow-xl hover:border-brand/40 transition-all p-8 rounded-xl relative overflow-hidden group">
                            <div className="absolute top-0 right-0 w-24 h-24 bg-brand/5 rounded-bl-full -mr-8 -mt-8 group-hover:bg-brand/10 transition-colors" />
                            <div className="flex flex-col gap-6 relative z-10">
                              <div className="flex justify-between items-start gap-4">
                                <div className="space-y-2 flex-1">
                                  <span className="text-[10px] font-black text-brand uppercase tracking-widest bg-brand/10 px-2 py-0.5 rounded-sm">{item.醫院名稱}</span>
                                  <h3 className="text-2xl font-bold text-gray-800 font-serif leading-tight">{item.產品名稱}</h3>
                                </div>
                                <div className="bg-earth-bg px-5 py-3 border border-earth-border rounded-lg shadow-inner text-center min-w-[100px]">
                                   <span className="text-[9px] text-gray-400 block mb-1 font-black uppercase tracking-widest">Hospital Code</span>
                                   <span className="text-sm font-mono font-black text-gray-700">{item.院內碼}</span>
                                </div>
                              </div>
                              <div className="grid grid-cols-2 gap-8 pt-6 border-t border-earth-border/40">
                                <div><span className="text-[10px] text-gray-400 block mb-1.5 uppercase font-black tracking-tighter">Model / Spec</span><span className="text-[13px] text-gray-600 font-medium leading-relaxed break-words">{item.型號}</span></div>
                                {item.健保碼 && <div><span className="text-[10px] text-gray-400 block mb-1.5 uppercase font-black tracking-tighter">NHI Code</span><span className="text-[13px] text-gray-600 font-medium leading-relaxed">{item.健保碼}</span></div>}
                              </div>
                              {item.批價碼 && (
                                <div className="pt-2">
                                  <span className="text-[10px] text-gray-400 block mb-1.5 uppercase font-black tracking-tighter">Billing Code</span>
                                  <span className="text-[13px] text-brand font-black bg-brand/5 px-2 py-1 rounded-sm">{item.批價碼}</span>
                                </div>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="space-y-4">
                          {Array.from(new Set(filteredData.map(i => i.醫院名稱))).sort().map(hospital => {
                              const hospData = filteredData.filter(i => i.醫院名稱 === hospital);
                              const isExpanded = expandedHospitals[hospital];
                              return (
                                  <div key={hospital} className="bg-white border border-earth-border rounded-xl shadow-sm overflow-hidden transition-all hover:border-brand/40">
                                      <div 
                                          className="px-6 py-4 flex items-center justify-between cursor-pointer hover:bg-[#F9F9F7] transition-colors"
                                          onClick={() => setExpandedHospitals(prev => ({...prev, [hospital]: !prev[hospital]}))}
                                      >
                                          <div className="flex items-center gap-4">
                                              {isExpanded ? <ChevronDown size={20} className="text-brand" /> : <ChevronRight size={20} className="text-gray-400" />}
                                              <span className="text-lg font-bold text-gray-800">{hospital}</span>
                                          </div>
                                          <div className="flex items-center gap-3">
                                              <span className="text-xs bg-brand/10 text-brand px-3 py-1 rounded-full font-black tracking-widest">{hospData.length} ITEMS</span>
                                          </div>
                                      </div>
                                      {isExpanded && (
                                          <div className="border-t border-earth-border/50 bg-[#F0EFEB]/30">
                                              <div className="overflow-x-auto">
                                                  <table className="w-full text-left">
                                                      <thead className="bg-[#F0EFEB] text-gray-500 font-sans font-bold text-[10px] uppercase tracking-widest">
                                                          <tr>
                                                              <th className="px-6 py-3 font-semibold">產品名稱</th>
                                                              <th className="px-6 py-3 font-semibold">型號</th>
                                                              <th className="px-6 py-3 font-semibold">院內碼</th>
                                                              <th className="px-6 py-3 font-semibold">批價碼</th>
                                                          </tr>
                                                      </thead>
                                                      <tbody className="divide-y divide-earth-border/50 text-xs text-gray-700">
                                                          {hospData.map((item, idx) => (
                                                              <tr key={idx} className="hover:bg-white transition-colors bg-[#F9F9F7]/50">
                                                                  <td className="px-6 py-4 font-bold text-gray-800">{item.產品名稱}</td>
                                                                  <td className="px-6 py-4 font-mono text-[11px] text-gray-500">{item.型號}</td>
                                                                  <td className="px-6 py-4"><span className="font-mono font-black border border-gray-200 bg-white px-2 py-1 rounded shadow-sm">{item.院內碼}</span></td>
                                                                  <td className="px-6 py-4">{item.批價碼 && <span className="text-brand font-black bg-brand/10 px-2 py-1 rounded-sm">{item.批價碼}</span>}</td>
                                                              </tr>
                                                          ))}
                                                      </tbody>
                                                  </table>
                                              </div>
                                          </div>
                                      )}
                                  </div>
                              );
                          })}
                      </div>
                    )
                ) : (
                    <div className="py-24 flex flex-col items-center justify-center opacity-30">
                        <Hospital size={100} strokeWidth={0.5} className="animate-bounce duration-[3000ms]" />
                        <div className="text-center mt-8">
                            <h3 className="text-3xl font-serif font-black tracking-tighter">無搜尋結果</h3>
                            <p className="text-sm font-light mt-2 uppercase tracking-[0.3em]">No Matching Records Found</p>
                            <button onClick={handleReset} className="mt-8 px-6 py-2 border border-brand text-brand hover:bg-brand hover:text-white transition-all text-xs font-black rounded-sm">重置所有條件</button>
                        </div>
                    </div>
                )}
              </div>
            ) : (
              /* Welcome 畫面 */
              <div className="bg-white p-12 md:p-24 border border-earth-border rounded-2xl shadow-[0_20px_60px_rgba(0,0,0,0.06)] text-center max-w-4xl mx-auto space-y-12 animate-in fade-in zoom-in-95 duration-1000 relative overflow-hidden group">
                  <div className="absolute top-0 left-0 w-full h-[8px] bg-gradient-to-r from-brand/20 via-brand to-brand/20 opacity-40" />
                  <div className="space-y-6">
                      <h2 className="text-5xl font-serif font-black text-gray-800 tracking-tighter group-hover:scale-105 transition-transform duration-700">Welcome</h2>
                      <p className="text-base font-light leading-relaxed text-gray-500 max-w-lg mx-auto">
                          請由左側選單選擇醫院或輸入代碼、產品關鍵字。<br />
                          點選 <span className="text-brand font-bold">SEARCH</span> 按鈕後，即可呈現搜尋結果。
                      </p>
                  </div>
                  <hr className="w-24 border-t-4 border-brand/10 mx-auto rounded-full" />
                  <div className="grid grid-cols-3 gap-8 max-w-md mx-auto opacity-20 group-hover:opacity-40 transition-opacity">
                      <div className="flex flex-col items-center gap-4"><Tag size={32} /><span className="text-[10px] font-black uppercase tracking-widest">Model</span></div>
                      <div className="flex flex-col items-center gap-4"><ClipboardList size={32} /><span className="text-[10px] font-black uppercase tracking-widest">Code</span></div>
                      <div className="flex flex-col items-center gap-4"><Search size={32} /><span className="text-[10px] font-black uppercase tracking-widest">Search</span></div>
                  </div>
                  
                  <div className="pt-12">
                      <p className="text-[10px] text-gray-400 font-black uppercase tracking-[0.4em]">Official Medical Database System</p>
                  </div>
              </div>
            )}
        </div>
      </main>
      
      <style jsx global>{`
        .custom-scrollbar::-webkit-scrollbar { width: 5px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #d3d3d3; border-radius: 10px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: #6d8b74; }
        
        body {
            overflow-x: hidden;
            background-color: #F9F9F7;
        }
      `}</style>
    </div>
  );
}
