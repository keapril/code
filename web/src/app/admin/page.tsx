'use client';

import React, { useState, useRef } from 'react';
import * as XLSX from 'xlsx';
import { Upload, FileSpreadsheet, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';
import Link from 'next/link';

// 醫院白名單
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
const ALL_VALID_HOSPITALS = [...PUBLIC_HOSPITALS, ...MANAGER_HOSPITALS];

export interface HospitalItem {
    醫院名稱: string;
    型號: string;
    產品名稱: string;
    健保碼: string;
    院內碼: string;
    批價碼: string;
    原始備註: string;
    搜尋用字串: string;
}

export default function AdminPage() {
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [fileName, setFileName] = useState<string>('');
    const [status, setStatus] = useState<'idle' | 'parsing' | 'uploading' | 'success' | 'error'>('idle');
    const [message, setMessage] = useState<string>('');

    // 完全自 Python 移植的強健清洗邏輯
    const processExcelData = (rawData: any[][]): HospitalItem[] => {
        // 1. 基礎清理：空值轉空字串，全部 toString 後 trim
        const data = rawData.map(row => 
            row.map(cell => {
                if (cell === null || cell === undefined) return '';
                const str = String(cell).trim();
                return str.toLowerCase() === 'nan' ? '' : str;
            })
        );
        
        let firstRow = 0;
        while(firstRow < data.length && data[firstRow].every(c => c === '')) firstRow++;
        let lastRow = data.length - 1;
        while(lastRow >= 0 && data[lastRow].every(c => c === '')) lastRow--;
        
        if (firstRow > lastRow || data.length === 0) throw new Error("Excel 檔案為空或無有效資料");
        const cleanData = data.slice(firstRow, lastRow + 1);

        const maxCols = Math.max(...cleanData.map(r => r.length));
        cleanData.forEach(r => {
            while(r.length < maxCols) r.push('');
        });

        // 2. 自動偵測標題列
        let header_col_idx = -1;
        for (let c = 0; c < Math.min(15, maxCols); c++) {
            const hasModel = cleanData.some(row => String(row[c]).includes('型號'));
            if (hasModel) {
                header_col_idx = c;
                break;
            }
        }
        if (header_col_idx === -1) throw new Error("錯誤：無法偵測標題欄 (找不到包含『型號』的列)。");

        const findRowIndex = (keywords: string | string[]) => {
            const kws = Array.isArray(keywords) ? keywords : [keywords];
            for (const kw of kws) {
                const exactIdx = cleanData.findIndex(row => row[header_col_idx] === kw);
                if (exactIdx !== -1) return exactIdx;
                const noSpaceIdx = cleanData.findIndex(row => row[header_col_idx].replace(/\s/g, '') === kw);
                if (noSpaceIdx !== -1) return noSpaceIdx;
                const containsIdx = cleanData.findIndex(row => {
                    const text = row[header_col_idx];
                    return text.includes(kw) && text.length < 20;
                });
                if (containsIdx !== -1) return containsIdx;
            }
            return -1;
        };

        const idx_model = findRowIndex('型號');
        const idx_alias = findRowIndex(['客戶簡稱', '產品名稱', '品名']);
        const idx_nhi_code = findRowIndex(['健保碼', '自費碼', '健保碼(自費碼)']);
        const idx_permit = findRowIndex('許可證');

        if (idx_model === -1) throw new Error("錯誤：在表頭中找不到『型號』列。");

        // 3. 建構產品清單
        const products: Record<number, any> = {};
        for (let c = header_col_idx + 1; c < maxCols; c++) {
            const modelVal = cleanData[idx_model][c];
            if (!modelVal || modelVal.includes('祐新') || modelVal.includes('銀鐸') || modelVal.length > 2000) continue;
            
            const aliasVal = idx_alias !== -1 ? cleanData[idx_alias][c] : '';
            if (aliasVal.trim().toUpperCase() === 'ACP') continue;
            
            const nhiVal = idx_nhi_code !== -1 ? cleanData[idx_nhi_code][c] : '';
            const permitVal = idx_permit !== -1 ? cleanData[idx_permit][c] : '';

            let splitModels = modelVal.split(/[;,\n\r]/).map(m => m.trim()).filter(m => m);
            if (splitModels.length === 0) splitModels = [modelVal.trim()];

            const modelEntries = splitModels.map(m => {
                const mClean = m.replace(/[^a-zA-Z0-9]/g, '');
                return {
                    name: m,
                    searchString: `${m} ${mClean} ${aliasVal} ${nhiVal} ${permitVal}`.toLowerCase()
                };
            });

            products[c] = {
                entries: modelEntries,
                產品名稱: aliasVal,
                健保碼: nhiVal
            };
        }

        const known_indices = [idx_model, idx_alias, idx_nhi_code, idx_permit].filter(i => i !== -1);
        const exclude_keys = ['效期', 'QSD', '產地', 'Code', 'Listing', 'None', 'Hospital', 'source', '備註', '健保價', '許可證'];
        const processedList: any[] = [];

        // 4. 解析各醫院列資料
        for (let row_idx = 0; row_idx < cleanData.length; row_idx++) {
            const row = cleanData[row_idx];
            let row_header = row[header_col_idx];

            if (!row_header && header_col_idx > 0 && row_idx > 0) {
                const prev_val = cleanData[row_idx - 1][header_col_idx];
                if (prev_val) row_header = prev_val;
                cleanData[row_idx][header_col_idx] = prev_val; 
            }

            if (known_indices.includes(row_idx)) continue;
            if (!row_header) continue;
            if (exclude_keys.some(k => row_header.includes(k))) continue;

            let hospital_name = row_header.replace(/[\u200b\u200c\u200d\ufeff]/g, '').replace(/　/g, ' ');

            let isValid = false;
            if (hospital_name.includes("國立陽明")) {
                isValid = true;
            } else {
                isValid = ALL_VALID_HOSPITALS.some(v => v === hospital_name || (v.length > 1 && hospital_name.includes(v)));
            }
            if (!isValid) continue;

            for (const [colIdxStr, pInfo] of Object.entries(products)) {
                const colIdx = parseInt(colIdxStr, 10);
                const cell_content = row[colIdx];
                if (!cell_content) continue;

                const allMatches = [...cell_content.matchAll(/([#$]\s*[A-Za-z0-9\-\.\_]+)/g)].map(m => m[1]);
                let foundRelevantMatches: any[] = [];

                if (allMatches.length > 0) {
                    if (hospital_name.includes("台南市立") || hospital_name.includes("秀傳")) {
                        const hospCodes: string[] = [];
                        const billCodes: string[] = [];
                        for (const codeStr of allMatches) {
                            const cleanCode = codeStr.replace(/[#$]/g, '').trim();
                            if (cleanCode.toUpperCase().startsWith('B')) hospCodes.push(cleanCode);
                            else if (!/^[0-9]/.test(cleanCode[0])) billCodes.push(cleanCode);
                        }
                        foundRelevantMatches.push({
                            院內碼: hospCodes.join(', '),
                            批價碼: billCodes.join(', ')
                        });
                    } else {
                        // 區塊化解析確保 # 搭配正確日期與括號
                        const blocksMatch = [...cell_content.matchAll(/#\s*([A-Za-z0-9\-\.\_]+)([^#]*?)(?=#|$)/g)];
                        const allCodeCandidates: any[] = [];
                        
                        if (blocksMatch.length > 0) {
                            for (const match of blocksMatch) {
                                const code = match[1].trim();
                                const contextText = match[2] || '';

                                let dateVal = 0;
                                const dates = [...contextText.matchAll(/(\d{2,4})\s*[/\.\-]\s*(\d{1,2})\s*[/\.\-]\s*(\d{1,2})/g)];
                                for (const d of dates) {
                                    let y = parseInt(d[1], 10);
                                    const m = parseInt(d[2], 10);
                                    const d_val = parseInt(d[3], 10);
                                    if (y >= 10 && y < 1000) y += 1911;
                                    else if (y < 100) y += 2000;
                                    const currentDate = y * 10000 + m * 100 + d_val;
                                    if (currentDate > dateVal) dateVal = currentDate;
                                }

                                let bracketModel: string | null = null;
                                const brackets = [...contextText.matchAll(/\(([^)]+)\)/g)];
                                for (const b of brackets) {
                                    const text = b[1].trim();
                                    if (/^[A-Za-z0-9\-]+$/.test(text) && !/^\d{2,4}[/\.\-]\d{1,2}/.test(text)) {
                                        bracketModel = text;
                                        break;
                                    }
                                }

                                allCodeCandidates.push({
                                    院內碼: code,
                                    批價碼: '',
                                    日期: dateVal,
                                    括號內容: bracketModel
                                });
                            }
                        }

                        // 按括號分組並優先選擇最新日期版
                        const groups: Record<string, any[]> = {};
                        for (const candidate of allCodeCandidates) {
                            const key = candidate.括號內容 || '';
                            if (!groups[key]) groups[key] = [];
                            groups[key].push(candidate);
                        }

                        for (const candidates of Object.values(groups)) {
                            const withDate = candidates.filter(c => c.日期 > 0);
                            if (withDate.length > 0) {
                                const best = withDate.reduce((prev, curr) => curr.日期 > prev.日期 ? curr : prev);
                                foundRelevantMatches.push(best);
                            } else {
                                foundRelevantMatches.push(...candidates);
                            }
                        }
                    }
                } else {
                    foundRelevantMatches.push({ 院內碼: '', 批價碼: '' });
                }

                // 智慧括號配對與產生最終紀錄
                const productModelSet = new Set(pInfo.entries.map((e: any) => e.name));
                
                for (const pEntry of pInfo.entries) {
                    for (const match of foundRelevantMatches) {
                        if (!match.院內碼) continue;
                        
                        const bracketContent = match.括號內容;
                        if (bracketContent && productModelSet.has(bracketContent)) {
                            if (bracketContent === pEntry.name) {
                                processedList.push({
                                    醫院名稱: hospital_name,
                                    型號: pEntry.name,
                                    產品名稱: pInfo.產品名稱,
                                    健保碼: pInfo.健保碼,
                                    院內碼: match.院內碼,
                                    批價碼: match.批價碼 || '',
                                    原始備註: cell_content,
                                    搜尋用字串: pEntry.searchString,
                                    日期: match.日期 || 0
                                });
                            }
                        } else {
                            processedList.push({
                                醫院名稱: hospital_name,
                                型號: pEntry.name,
                                產品名稱: pInfo.產品名稱,
                                健保碼: pInfo.健保碼,
                                院內碼: match.院內碼,
                                批價碼: match.批價碼 || '',
                                原始備註: cell_content,
                                搜尋用字串: pEntry.searchString,
                                日期: match.日期 || 0
                            });
                        }
                    }
                }
            }
        }

        // 5. 分組去重 (醫院+產品+型號)
        // 使用日期作為去重的依據，保留相同 (醫院+產品+型號) 組合下，日期最新的一筆
        const uniqueMap = new Map<string, any>();
        for (const item of processedList) {
            const uniqueKey = `${item.醫院名稱}_${item.產品名稱}_${item.型號}`;
            if (!uniqueMap.has(uniqueKey)) {
                uniqueMap.set(uniqueKey, item);
            } else {
                const existing = uniqueMap.get(uniqueKey);
                if (item.日期 > existing.日期) {
                    uniqueMap.set(uniqueKey, item);
                }
            }
        }

        return Array.from(uniqueMap.values()).map(item => {
            const { 日期, ...rest } = item;
            return rest as HospitalItem;
        });
    };

    const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        setFileName(file.name);
        setStatus('parsing');
        setMessage('正在解析並清洗 Excel 檔案，這可能需要幾秒鐘...');

        try {
            // 利用 FileReader 將檔案轉為 ArrayBuffer 給 SheetJS 解析
            const reader = new FileReader();
            reader.onload = async (evt) => {
                try {
                    const data = evt.target?.result;
                    const workbook = XLSX.read(data, { type: 'binary' });
                    const sheetName = workbook.SheetNames[0];
                    const sheet = workbook.Sheets[sheetName];
                    
                    const rawData: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
                    
                    if (rawData.length === 0) throw new Error("Excel 檔案為空");

                    const cleanJSON = processExcelData(rawData);
                    
                    if (cleanJSON.length === 0) {
                        setStatus('error');
                        setMessage('解析後無任何有效資料。');
                        return;
                    }

                    setStatus('uploading');
                    setMessage(`已成功獲取 ${cleanJSON.length} 筆資料。開始寫入儲存體 (Cloudflare R2)...`);

                    const res = await fetch('/api/upload', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            fileName: file.name,
                            data: cleanJSON
                        })
                    });

                    const resData = await res.json();
                    
                    if (!res.ok) {
                        throw new Error(resData.error || '上傳失敗');
                    }

                    setStatus('success');
                    setMessage(`太棒了！已成功更新 ${resData.count} 筆資料至線上。請至首頁重整查看最新結果。`);

                } catch (error: any) {
                    console.error("處理錯誤:", error);
                    setStatus('error');
                    setMessage(error.message || '發生未知錯誤');
                }
            };
            reader.onerror = () => {
                setStatus('error');
                setMessage('檔案讀取失敗');
            };
            reader.readAsBinaryString(file);

        } catch (error: any) {
            console.error("處理錯誤:", error);
            setStatus('error');
            setMessage(error.message || '發生未知錯誤');
        }
    };

    return (
        <div className="min-h-screen bg-[#F9F9F7] flex flex-col items-center py-20 px-4 sm:px-6 lg:px-8 font-serif">
            
            <div className="w-full max-w-2xl bg-white shadow-sm border border-[#E5E5E5] rounded-3xl overflow-hidden mt-10">
                <div className="bg-[#F0EFEB] px-8 py-6 border-b border-[#E5E5E5] flex justify-between items-center">
                    <div>
                        <h2 className="text-2xl font-bold text-[#2C3639] tracking-wide">📦 資料庫後台管理</h2>
                        <p className="text-[#888] font-sans text-sm mt-1 uppercase tracking-wider">Database Maintenance</p>
                    </div>
                    <Link href="/" className="text-sm font-sans px-5 py-2 border rounded-full border-[#6D8B74] text-[#6D8B74] hover:bg-[#6D8B74] hover:text-white transition-all bg-white hover:bg-opacity-90 shadow-sm">
                        返回首頁
                    </Link>
                </div>

                <div className="p-8 font-sans">
                    {/* 上傳區域 */}
                    <div 
                        className={`border-2 border-dashed rounded-2xl p-12 text-center transition-all ${
                            status === 'uploading' || status === 'parsing' ? 'border-gray-200 bg-gray-50' : 'border-[#6D8B74] bg-[#F9F9F7] cursor-pointer hover:bg-white'
                        }`}
                        onClick={() => {
                            if (status === 'idle' || status === 'success' || status === 'error') {
                                fileInputRef.current?.click();
                            }
                        }}
                    >
                        <input 
                            type="file" 
                            accept=".xlsx, .xls, .csv" 
                            className="hidden" 
                            ref={fileInputRef}
                            onChange={handleFileChange}
                        />
                        
                        {(status === 'idle' || status === 'success' || status === 'error') && (
                            <div className="flex flex-col items-center justify-center space-y-4">
                                <FileSpreadsheet className="w-16 h-16 text-[#6D8B74] mb-2" strokeWidth={1.5}/>
                                <div className="text-lg text-[#2C3639] font-medium tracking-wide">點擊選擇 Excel 檔案</div>
                                <div className="text-sm text-gray-500">所有的資料清洗、合併除錯與上傳將會自動完成。</div>
                            </div>
                        )}

                        {status === 'parsing' && (
                            <div className="flex flex-col items-center justify-center space-y-4">
                                <Loader2 className="w-16 h-16 text-[#6D8B74] animate-spin mb-2" />
                                <div className="text-lg text-[#2C3639] font-medium tracking-wide">正在解析資料...</div>
                            </div>
                        )}

                        {status === 'uploading' && (
                            <div className="flex flex-col items-center justify-center space-y-4">
                                <Upload className="w-16 h-16 text-[#6D8B74] animate-bounce mb-2" />
                                <div className="text-lg text-[#2C3639] font-medium tracking-wide">正在上傳至線上資料庫...</div>
                            </div>
                        )}
                    </div>

                    {/* 狀態提示 */}
                    {status !== 'idle' && (
                        <div className={`mt-6 p-4 rounded-xl border flex items-start gap-4 shadow-sm transition-all ${
                            status === 'error' ? 'bg-red-50 border-red-200 text-red-700' :
                            status === 'success' ? 'bg-green-50 border-green-200 text-green-700' :
                            'bg-white border-[#E5E5E5] text-[#2C3639]'
                        }`}>
                            {status === 'success' && <CheckCircle2 className="w-6 h-6 flex-shrink-0 text-green-600 mt-1" />}
                            {status === 'error' && <AlertCircle className="w-6 h-6 flex-shrink-0 text-red-600 mt-1" />}
                            {(status === 'parsing' || status === 'uploading') && <Loader2 className="w-6 h-6 flex-shrink-0 animate-spin text-[#6D8B74] mt-1" />}
                            
                            <div className="flex-1">
                                <p className="font-semibold text-base">{fileName}</p>
                                <p className="text-sm mt-1 leading-relaxed opacity-90">{message}</p>
                            </div>
                        </div>
                    )}

                </div>
            </div>

            <div className="mt-8 text-center text-sm text-[#888] font-sans tracking-wide">
                <p>Intelli-Spect Data Pipeline • Edge Runtime</p>
            </div>
        </div>
    );
}
