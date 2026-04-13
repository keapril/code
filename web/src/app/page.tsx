"use client";

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Search, RotateCcw, ShieldCheck, ListFilter, Hospital, ClipboardList, Tag, LayoutGrid, List, Download, Upload, Loader2, X } from 'lucide-react';
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
  const [adminKey, setAdminKey] = useState("");
  const [showAdminTab, setShowAdminTab] = useState(false);

  // 顯示控制
  const [displayMode, setDisplayMode] = useState<'card' | 'list'>('card');
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

  // 取得當前可見的醫院清單
  const availableHospitals = useMemo(() => {
    const dbHospitals = Array.from(new Set(data.map(item => item.醫院名稱)));
    const allowed = (isManager || isAdmin) ? [...PUBLIC_HOSPITALS, ...MANAGER_HOSPITALS] : PUBLIC_HOSPITALS;
    return dbHospitals
      .filter(h => allowed.some(a => h === a || h.includes(a)))
      .sort((a, b) => a.localeCompare(b, "zh-Hant"));
  }, [data, isManager, isAdmin]);

  // 執行過濾邏輯
  const filteredData = useMemo(() => {
    if (!data.length) return [];
    
    let result = data;

    // 1. 醫院權限與選擇過濾
    const allowed = (isManager || isAdmin) ? [...PUBLIC_HOSPITALS, ...MANAGER_HOSPITALS] : PUBLIC_HOSPITALS;
    result = result.filter(item => allowed.some(a => item.醫院名稱 === a || item.醫院名稱.includes(a)));

    if (selectedHospitals.length > 0) {
      result = result.filter(item => selectedHospitals.includes(item.醫院名稱));
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

    // 3. 關鍵字搜尋
    if (keyQuery) {
      const keys = keyQuery.split(/\s+/).filter(k => k);
      for (const k of keys) {
        const q = k.toLowerCase();
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
  }, [data, selectedHospitals, codeQuery, keyQuery, isManager, isAdmin]);

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
      if (adminKey === "163") {
          setIsManager(true);
          setIsAdmin(false);
          setShowAdminTab(false);
          setAdminKey("");
      } else if (adminKey === "197") {
          setIsAdmin(true);
          setIsManager(true);
          setShowAdminTab(false);
          setAdminKey("");
      } else {
          alert("密碼無效");
      }
  };

  // 匯出功能
  const handleExport = (format: 'csv' | 'xlsx') => {
      if (filteredData.length === 0) return;
      
      const exportData = filteredData.map(item => ({
          '醫院名稱': item.醫院名稱,
          '產品名稱': item.產品名稱,
          '型號': item.型號,
          '院內碼': item.院內碼,
          '批價碼': item.批價碼,
          '健保碼': item.健保碼 || '',
          '備註': item.原始備註
      }));

      const ws = XLSX.utils.json_to_sheet(exportData);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "院內碼結果");

      if (format === 'xlsx') {
          XLSX.writeFile(wb, `院內碼匯出_${new Date().toISOString().slice(0, 10)}.xlsx`);
      } else {
          XLSX.writeFile(wb, `院內碼匯出_${new Date().toISOString().slice(0, 10)}.csv`, { bookType: 'csv' });
      }
  };

  // 處理檔案上傳
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      setUploading(true);
      setUploadStatus(null);

      const formData = new FormData();
      formData.append('file', file);
      formData.append('password', '197');

      try {
          const res = await fetch('/api/upload', {
              method: 'POST',
              body: formData,
          });
          const result = await res.json();
          if (res.ok) {
              setUploadStatus({ type: 'success', msg: `匯入成功！共 ${result.count} 筆資料。` });
              fetchData(); // 重新整理資料
              if (fileInputRef.current) fileInputRef.current.value = "";
          } else {
              setUploadStatus({ type: 'error', msg: result.error || "上傳失敗" });
          }
      } catch (err) {
          setUploadStatus({ type: 'error', msg: "網路或系統錯誤" });
      } finally {
          setUploading(false);
      }
  };

  if (loading) return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-earth-bg animate-pulse">
      <div className="w-12 h-12 border-4 border-brand border-t-transparent rounded-full animate-spin mb-4" />
      <p className="text-earth-text/60 font-serif">載入資料庫中...</p>
    </div>
  );

  return (
    <div className="min-h-screen bg-earth-bg flex flex-col md:flex-row font-sans text-earth-text">
      
      {/* --- Sidebar --- */}
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
            {!isManager && !isAdmin ? (
               <button 
                onClick={() => setShowAdminTab(!showAdminTab)}
                className="text-xs flex items-center gap-1.5 text-gray-400 hover:text-brand transition-colors"
               >
                 <ShieldCheck size={14} /> {showAdminTab ? "隱藏登入" : "身分登入"}
               </button>
            ) : (
               <div className="bg-brand/10 px-3 py-1.5 rounded flex items-center justify-between">
                 <span className="text-xs text-brand font-medium flex items-center gap-1.5">
                   <ShieldCheck size={14} /> {isAdmin ? "Admin (197)" : "Manager (163)"}
                 </span>
                 <button onClick={() => { setIsAdmin(false); setIsManager(false); }} className="text-brand hover:opacity-70 text-xs">退出</button>
               </div>
            )}
            
            {showAdminTab && !isAdmin && !isManager && (
              <div className="mt-2 flex gap-2">
                <input 
                  type="password" 
                  placeholder="Key" 
                  className="bg-white border text-xs px-2 py-1 flex-1 rounded focus:outline-none focus:border-brand"
                  value={adminKey}
                  onChange={(e) => setAdminKey(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && handleLogin()}
                />
                <button 
                  onClick={handleLogin}
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
                   value={selectedHospitals.length > 0 ? selectedHospitals[0] : "ALL"}
                   onChange={(e) => {
                     const val = e.target.value;
                     if (val === "ALL") setSelectedHospitals([]);
                     else setSelectedHospitals([val]);
                     handleSearchTrigger();
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
                onChange={(e) => {
                    setCodeQuery(e.target.value);
                    if (e.target.value) handleSearchTrigger();
                }}
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
                  onChange={(e) => {
                      setKeyQuery(e.target.value);
                      if (e.target.value) handleSearchTrigger();
                  }}
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

          {/* 管理員上傳區塊 */}
          {isAdmin && (
              <div className="pt-6 border-t border-earth-border space-y-4">
                  <label className="text-xs font-serif font-bold text-brand flex items-center gap-2">
                    <Upload size={14} /> 資料維護 (197)
                  </label>
                  <div className="space-y-2">
                      <input 
                        type="file" 
                        accept=".xlsx,.csv" 
                        ref={fileInputRef}
                        onChange={handleFileUpload}
                        className="hidden"
                        id="admin-upload"
                        disabled={uploading}
                      />
                      <label 
                        htmlFor="admin-upload"
                        className={`w-full py-2 px-3 border-2 border-dashed border-brand/30 rounded flex flex-col items-center justify-center gap-2 cursor-pointer hover:bg-brand/5 transition-all ${uploading ? 'opacity-50 pointer-events-none' : ''}`}
                      >
                         {uploading ? <Loader2 className="animate-spin text-brand" size={18} /> : <Upload className="text-brand" size={18} />}
                         <span className="text-[10px] text-brand/70 font-medium">點擊上傳 Excel/CSV</span>
                      </label>
                      {uploadStatus && (
                          <div className={`text-[10px] p-2 rounded flex justify-between items-center ${uploadStatus.type === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
                             <span>{uploadStatus.msg}</span>
                             <button onClick={() => setUploadStatus(null)}><X size={12} /></button>
                          </div>
                      )}
                  </div>
              </div>
          )}

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
        {hasSearched ? (
          <div className="space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-700">
            {/*工具列 */}
            <div className="flex flex-col sm:flex-row items-center justify-between border-b border-earth-border pb-4 gap-4">
               <div>
                  <span className="text-sm font-serif text-gray-400 italic">Found {filteredData.length} items</span>
               </div>
               
               <div className="flex items-center gap-4">
                  {/* 顯示模式切換 */}
                  <div className="flex bg-white border border-earth-border rounded p-1">
                      <button 
                        onClick={() => setDisplayMode('card')}
                        className={`p-1.5 rounded transition-all ${displayMode === 'card' ? 'bg-brand text-white shadow-sm' : 'text-gray-400 hover:text-gray-600'}`}
                        title="卡片視圖"
                      >
                        <LayoutGrid size={16} />
                      </button>
                      <button 
                        onClick={() => setDisplayMode('list')}
                        className={`p-1.5 rounded transition-all ${displayMode === 'list' ? 'bg-brand text-white shadow-sm' : 'text-gray-400 hover:text-gray-600'}`}
                        title="列表視圖"
                      >
                        <List size={16} />
                      </button>
                  </div>

                  {/* 下載按鈕 */}
                  <div className="flex gap-2">
                      <button 
                        onClick={() => handleExport('csv')}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-earth-border rounded text-xs text-gray-600 hover:border-brand hover:text-brand transition-all"
                      >
                        <Download size={14} /> CSV
                      </button>
                      <button 
                        onClick={() => handleExport('xlsx')}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-earth-border rounded text-xs text-gray-600 hover:border-brand hover:text-brand transition-all"
                      >
                        <Download size={14} /> EXCEL
                      </button>
                  </div>
               </div>
            </div>
            
            {filteredData.length > 0 ? (
                displayMode === 'card' ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2 gap-6">
                    {filteredData.map((item, idx) => (
                      <div 
                        key={`${item.院內碼}-${idx}`} 
                        className="bg-white border border-earth-border hover:border-brand/40 transition-all p-6 group relative"
                      >
                        <div className="flex flex-col gap-4">
                          <div className="flex justify-between items-start">
                            <div className="space-y-1 flex-1 pr-4">
                              <span className="text-[10px] font-bold text-brand uppercase tracking-widest block">{item.醫院名稱}</span>
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
                ) : (
                  /* 列表模式 */
                  <div className="bg-white border border-earth-border overflow-hidden rounded shadow-sm">
                      <div className="overflow-x-auto">
                          <table className="w-full text-left border-collapse">
                              <thead className="bg-[#F0EFEB] border-b-2 border-brand text-gray-800 font-serif font-bold text-sm">
                                  <tr>
                                      <th className="px-4 py-3 whitespace-nowrap">醫院名稱</th>
                                      <th className="px-4 py-3 whitespace-nowrap">產品名稱</th>
                                      <th className="px-4 py-3 whitespace-nowrap">型號</th>
                                      <th className="px-4 py-3 whitespace-nowrap">院內碼</th>
                                      <th className="px-4 py-3 whitespace-nowrap">批價碼</th>
                                  </tr>
                              </thead>
                              <tbody className="divide-y divide-earth-border text-xs text-gray-600">
                                  {filteredData.map((item, idx) => (
                                      <tr key={idx} className="hover:bg-brand/5 transition-colors">
                                          <td className="px-4 py-3 text-brand font-bold">{item.醫院名稱}</td>
                                          <td className="px-4 py-3 font-medium text-gray-700">{item.產品名稱}</td>
                                          <td className="px-4 py-3 font-mono">{item.型號}</td>
                                          <td className="px-4 py-3 font-mono font-bold">{item.院內碼}</td>
                                          <td className="px-4 py-3">{item.批價碼}</td>
                                      </tr>
                                  ))}
                              </tbody>
                          </table>
                      </div>
                  </div>
                )
            ) : (
                <div className="h-64 flex flex-col items-center justify-center space-y-4 opacity-40 grayscale">
                  <Hospital size={60} strokeWidth={0.5} />
                  <div className="text-center">
                    <h3 className="text-xl font-serif">NO RESULTS</h3>
                    <p className="text-xs font-light">請調整搜尋條件或選擇其他醫院</p>
                  </div>
                </div>
            )}
          </div>
        ) : (
          /* 歡迎畫面 */
          <div className="h-full flex flex-col items-center justify-center space-y-12 animate-in fade-in duration-1000">
            <div className="text-center space-y-4">
                <Hospital size={120} strokeWidth={0.3} className="mx-auto text-brand opacity-20" />
                <div className="space-y-2">
                    <h2 className="text-4xl font-serif font-bold text-gray-800 tracking-widest">Welcome</h2>
                    <p className="text-gray-400 font-light tracking-widest uppercase text-xs">Medical Product Database</p>
                </div>
            </div>
            
            <div className="max-w-md w-full bg-white p-8 border border-earth-border rounded shadow-sm text-center relative overflow-hidden">
                <div className="absolute top-0 left-0 w-1 h-full bg-brand/30"></div>
                <p className="text-sm font-light leading-relaxed text-gray-600 mb-6">
                    請由左側選單選擇醫院或輸入關鍵字。<br />
                    支援型號、產品名稱與院內碼的複合搜尋。
                </p>
                <div className="w-12 h-px bg-brand/20 mx-auto mb-6" />
                <div className="flex justify-center gap-8">
                    <div className="flex flex-col items-center gap-1 opacity-40">
                        <Tag size={16} />
                        <span className="text-[10px] uppercase tracking-tighter">Model</span>
                    </div>
                    <div className="flex flex-col items-center gap-1 opacity-40">
                        <ClipboardList size={16} />
                        <span className="text-[10px] uppercase tracking-tighter">Code</span>
                    </div>
                    <div className="flex flex-col items-center gap-1 opacity-40">
                        <ListFilter size={16} />
                        <span className="text-[10px] uppercase tracking-tighter">Filter</span>
                    </div>
                </div>
            </div>
            
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 w-full max-w-2xl opacity-30 mt-8">
                {PUBLIC_HOSPITALS.slice(0, 8).map(h => (
                    <div key={h} className="text-[10px] text-center font-serif border-b border-earth-border pb-1">
                        {h}
                    </div>
                ))}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
