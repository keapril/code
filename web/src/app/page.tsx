"use client";

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Search, RotateCcw, ShieldCheck, ListFilter, Hospital, ClipboardList, Tag, LayoutGrid, List, Download, Upload, Loader2, X, Folder } from 'lucide-react';
import * as XLSX from 'xlsx';

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

// 模糊匹配工具：移除空白後的包含比對
const matchesHospital = (target: string, allowedList: string[]) => {
    if (!target) return false;
    const cleanTarget = target.replace(/\s+/g, '');
    return allowedList.some(a => {
        const cleanA = a.replace(/\s+/g, '');
        return cleanTarget.includes(cleanA) || cleanA.includes(cleanTarget);
    });
};

export default function SearchPage() {
  const [data, setData] = useState<MedicalProduct[]>([]);
  const [metadata, setMetadata] = useState<Metadata | null>(null);
  const [loading, setLoading] = useState(true);
  
  // 搜尋狀態
  const [selectedHospitals, setSelectedHospitals] = useState<string[]>([]);
  const [codeQuery, setCodeQuery] = useState("");
  const [keyQuery, setKeyQuery] = useState("");
  
  // 權限狀態
  const [isManager, setIsManager] = useState(false); // 163
  const [isAdmin, setIsAdmin] = useState(false);     // 197
  const [adminChecked, setAdminChecked] = useState(false);
  const [adminKey, setAdminKey] = useState("");

  // 顯示控制
  const [displayMode, setDisplayMode] = useState<'card' | 'list'>('card');
  const [selectionMode, setSelectionMode] = useState<'single' | 'multiple'>('single');
  const [hasSearched, setHasSearched] = useState(false);

  // 上傳狀態
  const [uploading, setUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<{ type: 'success' | 'error', msg: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 載入資料
  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = () => {
    setLoading(true);
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
  };

  // 權限過濾邏輯：正確切換清單
  const allowedHospitals = useMemo(() => {
      // 197 管理員：查看全部
      if (isAdmin) return [...PUBLIC_HOSPITALS, ...MANAGER_HOSPITALS];
      // 163 主管：只看特定醫院
      if (isManager) return MANAGER_HOSPITALS;
      // 預設：只看公開南區醫院
      return PUBLIC_HOSPITALS;
  }, [isManager, isAdmin]);

  // 取得當前可見的醫院清單 (受權限控制)
  const availableHospitals = useMemo(() => {
    const dbHospitals = Array.from(new Set(data.map(item => item.醫院名稱)));
    return dbHospitals
      .filter(h => matchesHospital(h, allowedHospitals))
      .sort((a, b) => a.localeCompare(b, "zh-Hant"));
  }, [data, allowedHospitals]);

  // 執行過濾邏輯 (對應搜尋條件)
  const filteredData = useMemo(() => {
    if (!data.length) return [];
    
    let result = data;

    // 1. 權限過濾
    result = result.filter(item => matchesHospital(item.醫院名稱, allowedHospitals));

    // 2. 選擇條件過濾
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

  // 處理搜尋觸發
  const handleSearchTrigger = () => {
      setHasSearched(true);
  };

  // 重置
  const handleReset = () => {
    setSelectedHospitals([]);
    setCodeQuery("");
    setKeyQuery("");
    setHasSearched(false);
  };

  // 登入驗證
  const handleLogin = () => {
      const key = adminKey.trim();
      if (key === "163") {
          setIsManager(true);
          setIsAdmin(false);
          setAdminChecked(false);
          setAdminKey("");
          alert("主管模式登入成功 (v1.3)");
      } else if (key === "197") {
          setIsAdmin(true);
          setIsManager(false);
          setAdminChecked(false);
          setAdminKey("");
          alert("管理員模式登入成功 (v1.3)");
      } else {
          alert("密碼無效，請重新輸入");
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

  // 上傳
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]; if (!file) return;
      setUploading(true); setUploadStatus(null);
      const formData = new FormData(); formData.append('file', file); formData.append('password', '197');
      try {
          const res = await fetch('/api/upload', { method: 'POST', body: formData });
          const result = await res.json();
          if (res.ok) { setUploadStatus({ type: 'success', msg: `匯入成功！共 ${result.count} 筆資料。` }); fetchData(); if (fileInputRef.current) fileInputRef.current.value = ""; } 
          else setUploadStatus({ type: 'error', msg: result.error || "上傳失敗" });
      } catch (err) { setUploadStatus({ type: 'error', msg: "內部伺服器錯誤" }); } 
      finally { setUploading(false); }
  };

  if (loading) return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-earth-bg animate-pulse">
      <div className="w-12 h-12 border-4 border-brand border-t-transparent rounded-full animate-spin mb-4" />
      <p className="text-earth-text/60 font-serif">載入資料庫中...</p>
    </div>
  );

  return (
    <div className="min-h-screen bg-earth-bg flex flex-col md:flex-row font-sans text-earth-text">
      
      {/* --- Sidebar (左側面板) --- */}
      <aside className="w-full md:w-80 lg:w-96 bg-earth-sidebar border-b md:border-b-0 md:border-r border-earth-border overflow-y-auto z-10 shadow-[2px_0_8px_rgba(0,0,0,0.02)]">
        <div className="p-6 md:p-8 space-y-6">
          <div className="space-y-1">
            <h2 className="text-xl font-bold flex items-center gap-2 text-gray-700">
               <span className="bg-yellow-400 p-1 rounded text-white"><Folder size={18} /></span> 查詢目錄
            </h2>
            {metadata && (
                <div className="text-[10px] text-gray-400 font-medium">
                  <p>Last updated: {metadata.updated_at}</p>
                  <p>Version: {metadata.file_name}</p>
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
                  checked={adminChecked || isManager || isAdmin}
                  onChange={(e) => {
                      if (!isManager && !isAdmin) setAdminChecked(e.target.checked);
                      else { setIsAdmin(false); setIsManager(false); setAdminChecked(false); }
                  }}
                  className="w-4 h-4 rounded border-gray-300 text-brand focus:ring-brand"
                />
                <label htmlFor="admin-check" className="text-sm text-gray-500 cursor-pointer">Admin</label>
             </div>
             {(adminChecked && !isManager && !isAdmin) && (
                 <div className="flex gap-2 animate-in fade-in duration-300">
                    <input 
                      type="password" 
                      placeholder="Key (163/197)" 
                      value={adminKey}
                      onChange={(e) => setAdminKey(e.target.value)}
                      onKeyPress={(e) => e.key === 'Enter' && handleLogin()}
                      className="bg-white border text-xs px-2 py-1.5 flex-1 rounded focus:outline-none focus:border-brand shadow-sm"
                    />
                    <button onClick={handleLogin} className="bg-brand text-white text-xs px-3 py-1.5 rounded hover:opacity-90 active:scale-95 transition-all">進入</button>
                 </div>
             )}
             {(isManager || isAdmin) && (
                 <div className="bg-green-600/10 border border-green-600/20 px-3 py-2 rounded flex items-center justify-between animate-in zoom-in-95 duration-300 shadow-sm">
                     <span className="text-xs text-green-700 font-bold flex items-center gap-1.5">
                        <ShieldCheck size={14} /> {isAdmin ? "Admin (197) Enabled" : "Manager (163) Enabled"}
                     </span>
                     <button onClick={() => { setIsAdmin(false); setIsManager(false); }} className="text-green-700 hover:opacity-70 text-xs font-black">退出</button>
                 </div>
             )}
          </div>

          <div className="space-y-4">
             <div className="space-y-2">
                <label className="text-xs text-gray-400 font-medium">Display Mode</label>
                <div className="flex gap-4">
                   <label className="flex items-center gap-1.5 cursor-pointer">
                      <input type="radio" checked={selectionMode === 'single'} onChange={() => setSelectionMode('single')} className="text-brand focus:ring-brand" />
                      <span className="text-xs">Single</span>
                   </label>
                   <label className="flex items-center gap-1.5 cursor-pointer">
                      <input type="radio" checked={selectionMode === 'multiple'} onChange={() => setSelectionMode('multiple')} className="text-brand focus:ring-brand" />
                      <span className="text-xs">Multiple</span>
                   </label>
                </div>
             </div>

             {/* 搜尋條件區塊 (淺灰底色) */}
             <div className="bg-[#f2f2ef] p-5 rounded-lg border border-earth-border/40 space-y-6">
                <div className="space-y-3">
                    <label className="text-xs font-bold text-gray-600">01. 選擇醫院</label>
                    {selectionMode === 'single' ? (
                        <select 
                            className="w-full bg-white border border-earth-border rounded px-3 py-2 text-sm focus:ring-1 focus:ring-brand outline-none transition-all shadow-sm"
                            value={selectedHospitals[0] || "ALL"}
                            onChange={(e) => { 
                                setSelectedHospitals(e.target.value === "ALL" ? [] : [e.target.value]); 
                                handleSearchTrigger(); 
                            }}
                        >
                            <option value="ALL">(All Hospitals)</option>
                            {availableHospitals.map(h => <option key={h} value={h}>{h}</option>)}
                        </select>
                    ) : (
                        <div className="space-y-2 max-h-40 overflow-y-auto pr-2 custom-scrollbar bg-white p-2 rounded border border-earth-border shadow-inner">
                           {availableHospitals.length > 0 ? availableHospitals.map(h => (
                               <label key={h} className="flex items-center gap-2 cursor-pointer py-0.5">
                                  <input 
                                    type="checkbox" 
                                    checked={selectedHospitals.includes(h)} 
                                    onChange={(e) => {
                                        const next = e.target.checked ? [...selectedHospitals, h] : selectedHospitals.filter(x => x !== h);
                                        setSelectedHospitals(next);
                                        handleSearchTrigger();
                                    }}
                                    className="rounded border-gray-300 text-brand focus:ring-brand" 
                                  />
                                  <span className="text-xs truncate">{h}</span>
                               </label>
                           )) : <p className="text-[10px] text-gray-400 italic">無可用醫院</p>}
                        </div>
                    )}
                </div>

                <div className="space-y-3">
                    <label className="text-xs font-bold text-gray-600">02. 輸入代碼</label>
                    <input 
                        type="text" placeholder="院內碼 / 批價碼" value={codeQuery}
                        onChange={(e) => { setCodeQuery(e.target.value); if(e.target.value) handleSearchTrigger(); }}
                        className="w-full bg-white border border-earth-border rounded px-3 py-2 text-sm focus:ring-1 focus:ring-brand outline-none shadow-sm"
                    />
                </div>

                <div className="space-y-3">
                    <label className="text-xs font-bold text-gray-600">03. 關鍵字</label>
                    <input 
                        type="text" placeholder="型號 / 產品名" value={keyQuery}
                        onChange={(e) => { setKeyQuery(e.target.value); if(e.target.value) handleSearchTrigger(); }}
                        className="w-full bg-white border border-earth-border rounded px-3 py-2 text-sm focus:ring-1 focus:ring-brand outline-none shadow-sm"
                    />
                </div>

                <div className="flex gap-2 pt-2">
                    <button onClick={handleSearchTrigger} className="flex-1 py-1.5 bg-brand text-white rounded text-xs font-bold shadow-sm hover:opacity-90 uppercase tracking-widest transition-all">Search</button>
                    <button onClick={handleReset} className="flex-1 py-1.5 border border-gray-300 rounded text-xs text-gray-600 hover:bg-gray-100 uppercase tracking-widest transition-all">Reset</button>
                </div>
             </div>

             {/* 197 上傳區 */}
             {isAdmin && (
                  <div className="pt-4 space-y-3 animate-in fade-in slide-in-from-top-2">
                      <label className="text-xs font-bold text-brand flex items-center gap-2"><Upload size={14} /> 資料維護 (197)</label>
                      <input type="file" ref={fileInputRef} onChange={handleFileUpload} className="hidden" id="admin-upload" disabled={uploading}/>
                      <label htmlFor="admin-upload" className={`w-full py-2 border-2 border-dashed border-brand/30 rounded flex flex-col items-center justify-center gap-2 cursor-pointer hover:bg-brand/5 shadow-sm ${uploading ? 'opacity-50 pointer-events-none' : ''}`}>
                         {uploading ? <Loader2 className="animate-spin text-brand" size={18} /> : <Upload className="text-brand" size={18} />}
                         <span className="text-[10px] text-brand/70 font-medium">點擊上傳 Excel/CSV</span>
                      </label>
                      {uploadStatus && <div className={`text-[10px] p-2 rounded flex justify-between items-center shadow-sm ${uploadStatus.type === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}><span>{uploadStatus.msg}</span><button onClick={() => setUploadStatus(null)}><X size={12} /></button></div>}
                  </div>
             )}
          </div>
        </div>
      </aside>

      {/* --- Main Content (右側主畫面) --- */}
      <main className="flex-1 overflow-y-auto w-full p-6 md:p-12 lg:p-16">
        <div className="max-w-6xl mx-auto space-y-12">
            
            {/* 中央標題區 (v1.3) */}
            <header className="text-center space-y-3 animate-in fade-in duration-700">
                <h1 className="text-4xl md:text-5xl font-serif font-bold text-gray-800 tracking-tight">
                    院內碼查詢系統 <span className="text-xs text-brand font-sans align-top opacity-50">v1.3</span>
                </h1>
                <hr className="w-full border-t-2 border-brand/40 max-w-sm mx-auto shadow-sm" />
                <p className="text-xs uppercase tracking-[0.2em] text-gray-400 font-bold pb-4">Medical Product Database</p>
            </header>

            {hasSearched ? (
              <div className="space-y-8 animate-in fade-in duration-500">
                <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
                   <span className="text-sm font-serif text-gray-400 italic">Results: {filteredData.length} items found</span>
                   <div className="flex items-center gap-4">
                      {/* 切換檢視 */}
                      <div className="flex bg-white border border-earth-border rounded p-1 shadow-sm">
                          <button onClick={() => setDisplayMode('card')} className={`p-1.5 rounded ${displayMode === 'card' ? 'bg-brand text-white shadow-sm' : 'text-gray-400 hover:text-gray-600'}`}><LayoutGrid size={16} /></button>
                          <button onClick={() => setDisplayMode('list')} className={`p-1.5 rounded ${displayMode === 'list' ? 'bg-brand text-white shadow-sm' : 'text-gray-400 hover:text-gray-600'}`}><List size={16} /></button>
                      </div>
                      {/* 下載 */}
                      <div className="flex gap-2">
                          <button onClick={() => handleExport('csv')} className="px-3 py-1.5 bg-white border border-earth-border rounded text-xs text-gray-600 hover:border-brand hover:text-brand transition-all shadow-sm flex items-center gap-1.5 font-bold"><Download size={14} /> CSV</button>
                          <button onClick={() => handleExport('xlsx')} className="px-3 py-1.5 bg-white border border-earth-border rounded text-xs text-gray-600 hover:border-brand hover:text-brand transition-all shadow-sm flex items-center gap-1.5 font-bold"><Download size={14} /> EXCEL</button>
                      </div>
                   </div>
                </div>
                
                {filteredData.length > 0 ? (
                    displayMode === 'card' ? (
                      <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">
                        {filteredData.map((item, idx) => (
                          <div key={idx} className="bg-white border border-earth-border hover:border-brand/40 transition-all p-7 shadow-sm hover:shadow-lg group relative rounded-lg border-b-4 border-b-brand/10">
                            <div className="flex flex-col gap-5">
                              <div className="flex justify-between items-start">
                                <div className="space-y-2 flex-1 pr-4">
                                  <span className="text-[10px] font-black text-brand uppercase tracking-widest">{item.醫院名稱}</span>
                                  <h3 className="text-xl font-bold text-gray-800 font-serif leading-snug">{item.產品名稱}</h3>
                                </div>
                                <div className="bg-earth-bg px-4 py-2 border border-earth-border rounded shadow-sm text-center">
                                   <span className="text-[10px] text-gray-400 block mb-1">院內碼</span>
                                   <span className="text-sm font-mono font-black text-gray-700">{item.院內碼}</span>
                                </div>
                              </div>
                              <div className="grid grid-cols-2 gap-6 pt-5 border-t border-earth-border/50">
                                <div><span className="text-[10px] text-gray-400 block mb-1 uppercase font-black tracking-tighter">規格型號</span><span className="text-xs text-gray-600 break-all">{item.型號}</span></div>
                                {item.健保碼 && <div><span className="text-[10px] text-gray-400 block mb-1 uppercase font-black tracking-tighter">健保碼</span><span className="text-xs text-gray-600">{item.健保碼}</span></div>}
                              </div>
                              {item.批價碼 && <div className="pt-2"><span className="text-[10px] text-gray-400 block mb-1 uppercase font-black tracking-tighter">批價碼</span><span className="text-xs text-brand font-black">{item.批價碼}</span></div>}
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="bg-white border border-earth-border rounded shadow-lg overflow-hidden animate-in fade-in duration-300">
                          <div className="overflow-x-auto">
                              <table className="w-full text-left border-collapse">
                                  <thead className="bg-[#F0EFEB] border-b-2 border-brand text-gray-800 font-serif font-bold text-xs uppercase tracking-[0.15em]">
                                      <tr><th className="px-5 py-5">醫院名稱</th><th className="px-5 py-5">產品名稱</th><th className="px-5 py-5">型號</th><th className="px-5 py-5 text-center">院內碼</th><th className="px-5 py-5">批價碼</th></tr>
                                  </thead>
                                  <tbody className="divide-y divide-earth-border text-[11px] text-gray-600">
                                      {filteredData.map((item, idx) => (
                                          <tr key={idx} className="hover:bg-brand/[0.03] transition-colors">
                                              <td className="px-5 py-5 text-brand font-black">{item.醫院名稱}</td>
                                              <td className="px-5 py-5 font-bold text-gray-700">{item.產品名稱}</td>
                                              <td className="px-5 py-5 font-mono">{item.型號}</td>
                                              <td className="px-5 py-5 font-mono font-black text-center text-gray-800">{item.院內碼}</td>
                                              <td className="px-5 py-5 font-medium">{item.批價碼}</td>
                                          </tr>
                                      ))}
                                  </tbody>
                              </table>
                          </div>
                      </div>
                    )
                ) : (
                    <div className="h-64 flex flex-col items-center justify-center opacity-40 grayscale animate-pulse">
                        <Hospital size={100} strokeWidth={0.3} />
                        <div className="text-center mt-6">
                            <h3 className="text-3xl font-serif font-bold">NO RESULTS</h3>
                            <p className="text-sm font-light mt-2 uppercase tracking-widest text-gray-500">請調整搜尋條件或選擇其他醫院</p>
                            <button onClick={handleReset} className="mt-6 text-brand font-bold underline text-xs">重置搜尋條件</button>
                        </div>
                    </div>
                )}
              </div>
            ) : (
              /* Welcome 畫面 */
              <div className="bg-white p-12 md:p-20 border border-earth-border rounded-lg shadow-[0_10px_40px_rgba(0,0,0,0.05)] text-center max-w-4xl mx-auto space-y-10 animate-in fade-in zoom-in-95 duration-1000 relative overflow-hidden">
                  <div className="absolute top-0 left-0 w-full h-[6px] bg-brand/30" />
                  <div className="space-y-4">
                      <h2 className="text-4xl font-serif font-black text-gray-800 tracking-tight">Welcome</h2>
                      <p className="text-sm font-light leading-relaxed text-gray-500 max-w-md mx-auto">
                          請由左側選單選擇醫院或輸入關鍵字。<br />
                          支援型號、產品名稱與院內碼的複合搜尋。
                      </p>
                  </div>
                  <hr className="w-20 border-t-2 border-brand/20 mx-auto" />
                  <div className="flex justify-center gap-12 opacity-30 mt-8">
                      <div className="flex flex-col items-center gap-3"><Tag size={24} /><span className="text-[10px] items-center uppercase tracking-widest font-black">Model</span></div>
                      <div className="flex flex-col items-center gap-3"><ClipboardList size={24} /><span className="text-[10px] items-center uppercase tracking-widest font-black">Code</span></div>
                      <div className="flex flex-col items-center gap-3"><Search size={24} /><span className="text-[10px] items-center uppercase tracking-widest font-black">Search</span></div>
                  </div>
                  
                  <div className="pt-10">
                      <p className="text-[10px] text-gray-400 font-bold uppercase tracking-[0.3em]">Authorized Access Only</p>
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
        }
      `}</style>
    </div>
  );
}
