import { NextRequest, NextResponse } from 'next/server';
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { s3Client, BUCKET_NAME, DATA_KEY, META_KEY } from '@/lib/s3';
import * as XLSX from 'xlsx';

export const runtime = 'nodejs';

// --- 醫院清單 (與 Python 版同步) ---
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

interface ProcessResult {
    data: any[];
    error?: string;
}

function processData(rows: any[][]): ProcessResult {
    try {
        // 基礎清理：移除全空的列
        const cleanRows = rows.filter(row => row.some(cell => cell !== null && cell !== undefined && cell !== ''));
        if (cleanRows.length === 0) return { data: [], error: "檔案內容經清理後為空" };

        // 偵測標題列
        let headerColIdx = -1;
        for (let c = 0; c < Math.min(15, cleanRows[0]?.length || 0); c++) {
            if (cleanRows.some(row => String(row[c] || '').includes('型號'))) {
                headerColIdx = c;
                break;
            }
        }

        if (headerColIdx === -1) return { data: [], error: "找不到『型號』欄位" };

        const headerColData = cleanRows.map(row => String(row[headerColIdx] || ''));

        function findRowIndex(keywords: string | string[]) {
            const keys = Array.isArray(keywords) ? keywords : [keywords];
            for (const kw of keys) {
                const idx = headerColData.findIndex(val => 
                    val === kw || val.replace(/\s/g, '') === kw || (val.includes(kw) && val.length < 20)
                );
                if (idx !== -1) return idx;
            }
            return -1;
        }

        const idxModel = findRowIndex('型號');
        const idxAlias = findRowIndex(['客戶簡稱', '產品名稱', '品名']);
        const idxNhiCode = findRowIndex(['健保碼', '自費碼', '健保碼(自費碼)']);
        const idxPermit = findRowIndex('許可證');

        if (idxModel === -1) return { data: [], error: "找不到『型號』列" };

        const products: Record<number, any> = {};
        const firstRow = cleanRows[idxModel];

        for (let colIdx = headerColIdx + 1; colIdx < firstRow.length; colIdx++) {
            const modelVal = String(firstRow[colIdx] || '').trim();
            if (!modelVal || modelVal.toLowerCase() === 'nan' || modelVal.includes('祐新') || modelVal.includes('銀鐸') || modelVal.length > 2000) continue;

            const aliasVal = idxAlias !== -1 ? String(cleanRows[idxAlias][colIdx] || '') : '';
            if (aliasVal.trim().toUpperCase() === 'ACP') continue;

            const nhiVal = idxNhiCode !== -1 ? String(cleanRows[idxNhiCode][colIdx] || '') : '';
            const permitVal = idxPermit !== -1 ? String(cleanRows[idxPermit][colIdx] || '') : '';

            const splitModels = modelVal.split(/[;,\n\r]/).map(m => m.trim()).filter(m => m);
            const modelEntries = splitModels.map(m => {
                const mClean = m.replace(/[^a-zA-Z0-9]/g, '');
                return {
                    name: m,
                    search_string: `${m} ${mClean} ${aliasVal} ${nhiVal} ${permitVal}`.toLowerCase()
                };
            });

            products[colIdx] = {
                entries: modelEntries,
                產品名稱: aliasVal,
                健保碼: nhiVal
            };
        }

        const knownIndices = [idxModel, idxAlias, idxNhiCode, idxPermit].filter(i => i !== -1);
        const excludeKeys = ['效期', 'QSD', '產地', 'Code', 'Listing', 'None', 'Hospital', 'source', '備註', '健保價', '許可證'];
        const processedList: any[] = [];

        cleanRows.forEach((row, rowIdx) => {
            let rowHeader = String(row[headerColIdx] || '').trim();
            if (!rowHeader && headerColIdx > 0) {
                const prevVal = String(row[headerColIdx - 1] || '').trim();
                if (prevVal && prevVal.toLowerCase() !== 'nan') rowHeader = prevVal;
            }

            if (knownIndices.includes(rowIdx) || !rowHeader || rowHeader.toLowerCase() === 'nan' || excludeKeys.some(k => rowHeader.includes(k))) return;

            const hospitalName = rowHeader.replace(/[\u200b\u200c\u200d\ufeff]/g, '').replace(/　/g, ' ');
            
            let isValid = hospitalName.includes("國立陽明");
            if (!isValid) {
                isValid = ALL_VALID_HOSPITALS.some(v => hospitalName === v || (v.length > 1 && hospitalName.includes(v)));
            }

            if (!isValid) return;

            Object.entries(products).forEach(([colIdxStr, pInfo]: [string, any]) => {
                const colIdx = parseInt(colIdxStr);
                const cellContent = String(row[colIdx] || '').trim();
                if (!cellContent || cellContent.toLowerCase() === 'nan') return;

                const patternBlocks = /#\s*([A-Za-z0-9\-\.\_]+)([^#]*?)(?=#|$)/gs;
                let match;
                const candidates: any[] = [];

                while ((match = patternBlocks.exec(cellContent)) !== null) {
                    const code = match[1].trim();
                    const contextText = match[2];

                    let dateVal = 0;
                    const dateMatches = contextText.matchAll(/(\d{2,4})\s*[/\.\-]\s*(\d{1,2})\s*[/\.\-]\s*(\d{1,2})/g);
                    for (const dm of dateMatches) {
                        let y = parseInt(dm[1]);
                        const m = parseInt(dm[2]);
                        const d = parseInt(dm[3]);
                        if (y >= 10 && y < 1000) y += 1911;
                        else if (y < 100) y += 2000;
                        const current_date = y * 10000 + m * 100 + d;
                        if (current_date > dateVal) dateVal = current_date;
                    }

                    let bracketModel: string | null = null;
                    const bracketMatches = contextText.matchAll(/\(([^)]+)\)/g);
                    for (const bm of bracketMatches) {
                        const bt = bm[1].trim();
                        if (/^[A-Za-z0-9\-]+$/.test(bt) && !(/^\d{2,4}[/\.\-]\d{1,2}/.test(bt))) {
                            bracketModel = bt;
                            break;
                        }
                    }

                    candidates.push({ 院內碼: code, 批價碼: '', 日期: dateVal, 括號內容: bracketModel });
                }

                if (candidates.length === 0) {
                    candidates.push({ 院內碼: '', 批價碼: '', 日期: 0, 括號內容: null });
                }

                const productModelSet = new Set(pInfo.entries.map((e: any) => e.name));
                
                pInfo.entries.forEach((pEntry: any) => {
                    candidates.forEach(cand => {
                        if (!cand.院內碼) return;

                        if (cand.括號內容 && productModelSet.has(cand.括號內容)) {
                            if (cand.括號內容 === pEntry.name) {
                                processedList.push({
                                    醫院名稱: hospitalName,
                                    型號: pEntry.name,
                                    產品名稱: pInfo.產品名稱,
                                    健保碼: pInfo.健保碼,
                                    院內碼: cand.院內碼,
                                    批價碼: '',
                                    原始備註: cellContent,
                                    搜尋用字串: pEntry.search_string,
                                    日期: cand.日期
                                });
                            }
                        } else {
                            processedList.push({
                                醫院名稱: hospitalName,
                                型號: pEntry.name,
                                產品名稱: pInfo.產品名稱,
                                健保碼: pInfo.健保碼,
                                院內碼: cand.院內碼,
                                批價碼: '',
                                原始備註: cellContent,
                                搜尋用字串: pEntry.search_string,
                                日期: cand.日期
                            });
                        }
                    });
                });
            });
        });

        // 去重與排序
        let result = processedList.sort((a, b) => b.日期 - a.日期);
        const seen = new Set();
        result = result.filter(item => {
            const key = `${item.醫院名稱}-${item.產品名稱}-${item.型號}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });

        // 移除日期
        result = result.map(({ 日期, ...rest }) => rest);

        return { data: result };

    } catch (e: any) {
        return { data: [], error: `處理錯誤: ${e.message}` };
    }
}

export async function POST(req: NextRequest) {
    try {
        const formData = await req.formData();
        const file = formData.get('file') as File;
        const password = formData.get('password') as string;

        if (password !== '197') {
            return NextResponse.json({ error: "密碼錯誤 (上傳權限需使用 197)" }, { status: 403 });
        }

        if (!file) {
            return NextResponse.json({ error: "請上傳檔案" }, { status: 400 });
        }

        const buffer = await file.arrayBuffer();
        const workbook = XLSX.read(buffer, { type: 'array' });
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];
        const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as any[][];

        const { data, error } = processData(rows);

        if (error) {
            return NextResponse.json({ error }, { status: 400 });
        }

        // --- 更新 R2 ---
        const updatedAt = new Date(new Date().getTime() + 8 * 3600000).toISOString().replace(/T/, ' ').replace(/\..+/, '').substring(0, 16);
        const fileName = file.name;

        // 1. 上傳資料檔 (JSON)
        await s3Client.send(new PutObjectCommand({
            Bucket: BUCKET_NAME,
            Key: DATA_KEY,
            Body: JSON.stringify(data),
            ContentType: 'application/json'
        }));

        // 2. 上傳中繼資料
        const metadata = {
            updated_at: updatedAt,
            file_name: fileName,
            record_count: data.length
        };
        await s3Client.send(new PutObjectCommand({
            Bucket: BUCKET_NAME,
            Key: META_KEY,
            Body: JSON.stringify(metadata),
            ContentType: 'application/json'
        }));

        return NextResponse.json({ success: true, count: data.length, updated_at: updatedAt });

    } catch (err: any) {
        console.error("Upload Error:", err);
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}
