import streamlit as st
import pandas as pd
import re
import os
import json
from datetime import datetime, timedelta
import time
import math

# --- Firebase 初始化 ---
import firebase_admin
from firebase_admin import credentials, firestore, storage

def init_firebase():
    """初始化 Firebase（只執行一次）"""
    if not firebase_admin._apps:
        try:
            # 從 Streamlit secrets 讀取 Firebase 金鑰
            firebase_config = dict(st.secrets["firebase"])
            cred = credentials.Certificate(firebase_config)
            
            # 設定 Storage bucket
            firebase_admin.initialize_app(cred, {
                'storageBucket': f"{firebase_config['project_id']}.appspot.com"
            })
        except Exception as e:
            st.error(f"Firebase 初始化失敗: {e}")
            return None
    return firestore.client()

# --- 1. 設定頁面配置 ---
st.set_page_config(
    page_title="醫療產品查詢系統", 
    layout="wide", 
    page_icon="🌿"
)

# --- 2. 設定：醫院白名單設定 (全域設定) ---

# A. 公開顯示 (南區醫院)
PUBLIC_HOSPITALS = [
    "成大", "台南市立(秀傳)", 
    "麻豆新樓", "臺南新樓", "安南新樓",
    "衛生福利部新營醫院", "衛生福利部嘉義醫院", "衛生福利部臺南醫院", "衛生福利部澎湖醫院",
    "奇美永康", "奇美佳里", "奇美柳營", 
    "嘉基", "嘉義陽明", "嘉榮", 
    "國軍高雄", "國軍高雄總醫院屏東分院", "國軍高雄總醫院岡山分院", 
    "義大", "高雄大同(長庚)", "高雄小港(高醫)", 
    "高雄市立民生醫院", "高雄市立聯合醫院", "高雄岡山(高醫)", 
    "高雄長庚", "高醫", 
    "屏東榮民總醫院", "屏東寶建", "屏基", 
    "衛生福利部屏東醫院", "衛生福利部恆春旅遊醫院", 
    "輔英", "阮綜合", "健仁", "右昌", "東港安泰", "郭綜合",
    "中國安南"
]

# B. 噥噥專用 (特定醫院)
MANAGER_HOSPITALS = [
    "新店慈濟", "台北慈濟", 
    "內湖三總", "三軍總醫院", 
    "松山三總", "松山分院", 
    "國立陽明大學",          
    "國立陽明交通大學",      
    "交通大學",              
    "輔大", "羅東博愛", 
    "衛生福利部臺北醫院", "部立臺北"
]

# C. 合併清單
ALL_VALID_HOSPITALS = PUBLIC_HOSPITALS + MANAGER_HOSPITALS

# Firestore Collection 名稱
FIRESTORE_COLLECTION = "medical_products"
FIRESTORE_METADATA_DOC = "metadata"
BATCH_SIZE = 500  # 每批筆數，確保不超過 1MB

# --- 3. CSS 樣式優化 ---
st.markdown("""
    <style>
    @import url('https://fonts.googleapis.com/css2?family=Noto+Serif+TC:wght@400;700&family=Lato:wght@300;400;700&display=swap');

    :root {
        --bg-color: #F9F9F7;
        --sidebar-bg: #F0EFEB;
        --text-main: #4A4A4A;
        --accent-color: #6D8B74;
        --border-color: #D3D3D3;
        --font-serif: 'Noto Serif TC', serif;
        --font-sans: 'Lato', sans-serif;
    }

    .stApp { background-color: var(--bg-color); color: var(--text-main); font-family: var(--font-sans); }
    [data-testid="stSidebar"] { background-color: var(--sidebar-bg); border-right: 1px solid #E5E5E5; }
    h1, h2, h3 { font-family: var(--font-serif) !important; color: #2C3639 !important; font-weight: 700; letter-spacing: 0.05em; }

    .main-header { font-size: 2.5rem; border-bottom: 2px solid var(--accent-color); padding-bottom: 10px; margin-bottom: 20px; text-align: center; }
    .sub-header { font-size: 1rem; color: #888; text-align: center; margin-top: -15px; margin-bottom: 30px; font-family: var(--font-sans); text-transform: uppercase; letter-spacing: 0.15em; }

    .stTextInput input, .stSelectbox div[data-baseweb="select"] > div, .stMultiSelect div[data-baseweb="select"] > div {
        background-color: #FFFFFF !important; border: 1px solid var(--border-color) !important; border-radius: 4px !important; color: var(--text-main) !important; box-shadow: none !important;
    }
    .stTextInput input:focus, div[data-baseweb="select"] > div:focus-within { border-color: var(--accent-color) !important; }

    div[data-testid="stForm"] button {
        background-color: transparent !important; color: var(--accent-color) !important; border: 1px solid var(--accent-color) !important; border-radius: 0px !important; font-family: var(--font-serif); letter-spacing: 1px; transition: all 0.3s ease; padding: 8px 16px;
    }
    div[data-testid="stForm"] button:hover { background-color: var(--accent-color) !important; color: white !important; }

    div[data-testid="stDataFrame"] { background-color: transparent; }
    #MainMenu {visibility: hidden;} footer {visibility: hidden;}
    .stCheckbox label span { font-family: var(--font-serif); color: #555; }
    .streamlit-expanderHeader { background-color: transparent !important; color: var(--text-main) !important; font-family: var(--font-serif); }
    </style>
""", unsafe_allow_html=True)

# --- 4. 資料處理核心邏輯 ---
def process_data(df):
    try:
        # 基礎清理
        df = df.dropna(how='all').dropna(axis=1, how='all').reset_index(drop=True)
        df = df.astype(str).apply(lambda x: x.str.strip())
        
        # 自動偵測標題列
        header_col_idx = -1
        for c in range(min(15, df.shape[1])):
            if df.iloc[:, c].astype(str).apply(lambda x: '型號' in x).any():
                header_col_idx = c
                break
        
        if header_col_idx == -1:
            return None, "錯誤：無法偵測標題欄 (找不到『型號』)。"

        header_col_data = df.iloc[:, header_col_idx]

        def find_row_index(keywords):
            if isinstance(keywords, str): keywords = [keywords]
            for kw in keywords:
                matches = header_col_data[header_col_data == kw]
                if not matches.empty: return matches.index[0]
                matches = header_col_data[header_col_data.str.replace(' ', '') == kw]
                if not matches.empty: return matches.index[0]
                matches = header_col_data[header_col_data.str.contains(kw, na=False) & (header_col_data.str.len() < 20)]
                if not matches.empty: return matches.index[0]
            return None

        idx_model = find_row_index('型號')
        idx_alias = find_row_index(['客戶簡稱', '產品名稱', '品名']) 
        idx_nhi_code = find_row_index(['健保碼', '自費碼', '健保碼(自費碼)'])
        idx_permit = find_row_index('許可證')
        
        if idx_model is None:
            return None, "錯誤：找不到『型號』列。"

        # 建構產品清單
        products = {}
        for col_idx in range(header_col_idx + 1, df.shape[1]):
            model_val = df.iloc[idx_model, col_idx]
            
            if (model_val == '' or model_val.lower() == 'nan' or 
                '祐新' in model_val or '銀鐸' in model_val or len(model_val) > 1000):
                continue
            
            alias_val = df.iloc[idx_alias, col_idx] if idx_alias is not None else ''
            
            if alias_val.strip().upper() == 'ACP':
                continue
                
            nhi_val = df.iloc[idx_nhi_code, col_idx] if idx_nhi_code is not None else ''
            permit_val = df.iloc[idx_permit, col_idx] if idx_permit is not None else ''
            
            model_clean = re.sub(r'[^a-zA-Z0-9]', '', str(model_val))
            products[col_idx] = {
                '型號': model_val,
                '產品名稱': alias_val,
                '健保碼': nhi_val,
                '搜尋用字串': f"{model_val} {model_clean} {alias_val} {nhi_val} {permit_val}".lower()
            }
        
        known_indices = [i for i in [idx_model, idx_alias, idx_nhi_code, idx_permit] if i is not None]
        exclude_keys = ['效期', 'QSD', '產地', 'Code', 'Listing', 'None', 'Hospital', 'source', '備註', '健保價', '許可證']
        
        processed_list = []

        for row_idx, row in df.iterrows():
            row_header = str(row.iloc[header_col_idx])
            
            if (row_header == '' or row_header.lower() == 'nan') and header_col_idx > 0:
                prev_val = str(row.iloc[header_col_idx - 1])
                if prev_val and prev_val.lower() != 'nan':
                    row_header = prev_val

            if row_idx in known_indices: continue
            if row_header == '' or row_header.lower() == 'nan': continue
            if any(k in row_header for k in exclude_keys): continue
            
            hospital_name = row_header.strip()
            hospital_name = re.sub(r'[\u200b\u200c\u200d\ufeff]', '', hospital_name)
            hospital_name = hospital_name.replace('　', ' ') 
            
            is_valid = False
            
            if "國立陽明" in hospital_name:
                is_valid = True
            else:
                for v_hosp in ALL_VALID_HOSPITALS:
                    if v_hosp == hospital_name:
                        is_valid = True
                        break
                    if len(v_hosp) > 1 and v_hosp in hospital_name:
                        is_valid = True
                        break
            
            if not is_valid: continue 

            for col_idx, p_info in products.items():
                cell_content = str(row.iloc[col_idx])
                
                if cell_content and str(cell_content).strip() != '' and str(cell_content).lower() != 'nan':
                    
                    pattern = r'(#\s*[A-Za-z0-9\-\.\_]+)'
                    all_matches = re.findall(pattern, cell_content)
                    
                    base_item = {
                        '醫院名稱': hospital_name,
                        '型號': p_info['型號'],
                        '產品名稱': p_info['產品名稱'],
                        '健保碼': p_info['健保碼'],
                        '院內碼': "",
                        '批價碼': "", 
                        '原始備註': cell_content,
                        '搜尋用字串': p_info['搜尋用字串']
                    }
                    
                    if all_matches:
                        if "台南市立" in hospital_name or "秀傳" in hospital_name:
                            hosp_codes = []
                            bill_codes = []
                            spec_model_update = None
                            
                            for code in all_matches:
                                clean_code = code.replace('#', '').strip()
                                if clean_code.upper().startswith('B'):
                                    hosp_codes.append(clean_code)
                                elif clean_code[0].isdigit(): 
                                    spec_model_update = clean_code
                                else:
                                    bill_codes.append(clean_code)
                            
                            new_item = base_item.copy()
                            new_item['院內碼'] = ", ".join(hosp_codes)
                            new_item['批價碼'] = ", ".join(bill_codes)
                            
                            if spec_model_update:
                                new_item['型號'] = spec_model_update
                                new_item['搜尋用字串'] += f" {spec_model_update}"

                            if new_item['院內碼'] or new_item['批價碼'] or spec_model_update:
                                processed_list.append(new_item)
                            else:
                                processed_list.append(base_item)
                                
                        else:
                            pattern_with_spec = r'(#\s*[A-Za-z0-9\-\.\_]+)(?:\s*[\n\r]*\(([^)]+)\))?'
                            matches_with_spec = re.findall(pattern_with_spec, cell_content)
                            
                            if matches_with_spec:
                                for code_raw, spec_text in matches_with_spec:
                                    new_item = base_item.copy()
                                    new_item['院內碼'] = code_raw.replace('#', '').strip()
                                    
                                    if spec_text:
                                        spec_text = spec_text.strip()
                                        exclude_spec = ['議價', '生效', '發票', '稅', '折讓', '贈', '單', '訂單', '通知', '健保', '關碼', '停用', '缺貨', '取代', '急採', '收費', '月', '年', '日', '/', '銀鐸', '祐新', 'ACP', 'acp']
                                        
                                        if not any(k in spec_text for k in exclude_spec) and len(spec_text) < 50:
                                            pure_spec = spec_text.split()[0]
                                            
                                            if not re.search(r'[\u4e00-\u9fff]', pure_spec):
                                                new_item['型號'] = pure_spec
                                                new_item['搜尋用字串'] += f" {pure_spec.lower()}"
                                    
                                    processed_list.append(new_item)
                            else:
                                for code in all_matches:
                                    new_item = base_item.copy()
                                    new_item['院內碼'] = code.replace('#', '').strip()
                                    processed_list.append(new_item)
                    else:
                        processed_list.append(base_item)

        return pd.DataFrame(processed_list), None

    except Exception as e:
        return None, f"處理錯誤: {str(e)}"

# === Firebase Storage 上傳 ===
def upload_to_storage(file_bytes, file_name):
    """將原始檔案上傳到 Firebase Storage（備份用）"""
    try:
        bucket = storage.bucket()
        blob = bucket.blob(f"uploads/{file_name}")
        blob.upload_from_string(file_bytes, content_type='application/octet-stream')
        return f"uploads/{file_name}"
    except Exception as e:
        st.warning(f"Storage 備份失敗（不影響主功能）: {e}")
        return None

# === Firebase 分批儲存 ===
def save_data_to_firebase(db, df, updated_at, original_file_path=None):
    """將 DataFrame 分批存到 Firestore（避免超過 1MB 限制）"""
    try:
        data_records = df.to_dict('records')
        total_records = len(data_records)
        total_batches = math.ceil(total_records / BATCH_SIZE)
        
        # 先刪除舊的批次資料
        clear_firebase_data(db, silent=True)
        
        # 分批存入
        for i in range(total_batches):
            start = i * BATCH_SIZE
            end = min(start + BATCH_SIZE, total_records)
            batch_data = data_records[start:end]
            
            doc_ref = db.collection(FIRESTORE_COLLECTION).document(f"batch_{i}")
            doc_ref.set({
                'data': batch_data,
                'batch_index': i
            })
        
        # 存入元資料
        meta_ref = db.collection(FIRESTORE_COLLECTION).document(FIRESTORE_METADATA_DOC)
        meta_ref.set({
            'updated_at': updated_at,
            'record_count': total_records,
            'total_batches': total_batches,
            'original_file': original_file_path
        })
        
        return True
    except Exception as e:
        st.error(f"儲存到 Firebase 失敗: {e}")
        return False

# === Firebase 讀取（合併所有批次）===
@st.cache_data(ttl=300, show_spinner=False)
def load_data_from_firebase(_db):
    """從 Firestore 讀取所有批次資料並合併"""
    try:
        # 先讀取元資料
        meta_ref = _db.collection(FIRESTORE_COLLECTION).document(FIRESTORE_METADATA_DOC)
        meta_doc = meta_ref.get()
        
        if not meta_doc.exists:
            return None
        
        meta_data = meta_doc.to_dict()
        total_batches = meta_data.get('total_batches', 0)
        updated_at = meta_data.get('updated_at', '未知')
        
        # 讀取所有批次
        all_records = []
        for i in range(total_batches):
            batch_ref = _db.collection(FIRESTORE_COLLECTION).document(f"batch_{i}")
            batch_doc = batch_ref.get()
            if batch_doc.exists:
                batch_data = batch_doc.to_dict().get('data', [])
                all_records.extend(batch_data)
        
        df = pd.DataFrame(all_records)
        return {'df': df, 'updated_at': updated_at}
    except Exception as e:
        st.error(f"從 Firebase 讀取失敗: {e}")
        return None

# === Firebase 清除所有資料 ===
def clear_firebase_data(db, silent=False):
    """清除 Firestore 所有批次資料"""
    try:
        # 先讀取元資料取得批次數
        meta_ref = db.collection(FIRESTORE_COLLECTION).document(FIRESTORE_METADATA_DOC)
        meta_doc = meta_ref.get()
        
        if meta_doc.exists:
            meta_data = meta_doc.to_dict()
            total_batches = meta_data.get('total_batches', 0)
            
            # 刪除所有批次文檔
            for i in range(total_batches):
                db.collection(FIRESTORE_COLLECTION).document(f"batch_{i}").delete()
        
        # 刪除元資料
        meta_ref.delete()
        return True
    except Exception as e:
        if not silent:
            st.error(f"清除 Firebase 資料失敗: {e}")
        return False

def filter_hospitals(all_hospitals, allow_list):
    filtered = []
    for h in all_hospitals:
        if "聯醫" in h or "北市聯醫" in h:
            continue

        for allow in allow_list:
            if allow == h or allow in h:
                filtered.append(h)
                break 
    return sorted(list(set(filtered)))

# --- 5. 主程式 ---
def main():
    # 初始化 Firebase
    db = init_firebase()
    
    if db is None:
        st.error("⚠️ Firebase 連線失敗，請檢查 Secrets 設定")
        st.info("""
        請在 Streamlit Cloud Dashboard → Settings → Secrets 中加入：
        ```toml
        [firebase]
        type = "service_account"
        project_id = "你的專案ID"
        private_key_id = "..."
        private_key = "-----BEGIN PRIVATE KEY-----\\n...\\n-----END PRIVATE KEY-----\\n"
        client_email = "..."
        client_id = "..."
        auth_uri = "[https://accounts.google.com/o/oauth2/auth](https://accounts.google.com/o/oauth2/auth)"
        token_uri = "[https://oauth2.googleapis.com/token](https://oauth2.googleapis.com/token)"
        ```
        """)
        return
    
    # 讀取資料
    db_content = load_data_from_firebase(db)
    
    if isinstance(db_content, dict):
        st.session_state.data = db_content.get('df')
        st.session_state.last_updated = db_content.get('updated_at', "未知")
    else:
        st.session_state.data = None
        st.session_state.last_updated = ""

    # 初始化其他變數
    if 'has_searched' not in st.session_state: st.session_state.has_searched = False
    if 'qry_hosp' not in st.session_state: st.session_state.qry_hosp = []
    if 'qry_code' not in st.session_state: st.session_state.qry_code = ""
    if 'qry_key' not in st.session_state: st.session_state.qry_key = ""
    if 'is_manager_mode' not in st.session_state: st.session_state.is_manager_mode = False

    # --- 側邊欄 ---
    with st.sidebar:
        st.markdown("### 🗂️ 查詢目錄")
        
        if st.session_state.last_updated:
            st.caption(f"Last updated: {st.session_state.last_updated}")
        
        st.markdown("---")
        
        # Admin 模式開關
        c_mode, c_pwd = st.columns([1, 2])
        with c_mode:
            show_manager = st.checkbox("Admin", value=st.session_state.is_manager_mode)
        
        if show_manager and not st.session_state.is_manager_mode:
            m_pwd = st.text_input("Password", type="password", key="manager_pwd_input", label_visibility="collapsed", placeholder="Key")
            if m_pwd == "163": 
                st.session_state.is_manager_mode = True
                st.rerun()
            elif m_pwd:
                st.error("Invalid")
        elif not show_manager and st.session_state.is_manager_mode:
             st.session_state.is_manager_mode = False
             st.rerun()

        if st.session_state.data is not None and not st.session_state.data.empty:
            df = st.session_state.data
            all_db_hospitals = df['醫院名稱'].unique().tolist()
            display_hosp_list = filter_hospitals(all_db_hospitals, MANAGER_HOSPITALS if st.session_state.is_manager_mode else PUBLIC_HOSPITALS)
            
            mode = st.radio("Display Mode", ["Single", "Multiple"], index=0, horizontal=True)
            
            with st.form("search_form"):
                st.markdown("#### 01. 選擇醫院")
                if "Single" in mode:
                    hosp_options = ["(All Hospitals)"] + display_hosp_list
                    default_idx = 0
                    if st.session_state.qry_hosp and len(st.session_state.qry_hosp) == 1:
                        if st.session_state.qry_hosp[0] in hosp_options:
                            default_idx = hosp_options.index(st.session_state.qry_hosp[0])
                    s_hosp_single = st.selectbox("Hospital", options=hosp_options, index=default_idx, label_visibility="collapsed")
                    s_hosp = [s_hosp_single] if s_hosp_single != "(All Hospitals)" else []
                else:
                    default_opts = [h for h in st.session_state.qry_hosp if h in display_hosp_list]
                    s_hosp = st.multiselect("Hospital", options=display_hosp_list, default=default_opts, label_visibility="collapsed")
                
                st.markdown("#### 02. 輸入代碼")
                s_code = st.text_input("Code", value=st.session_state.qry_code, placeholder="院內碼", label_visibility="collapsed")
                
                st.markdown("#### 03. 關鍵字")
                s_key = st.text_input("Keywords", value=st.session_state.qry_key, placeholder="型號 / 產品名", label_visibility="collapsed")
                
                st.markdown("<br>", unsafe_allow_html=True)
                
                c1, c2 = st.columns(2)
                with c1: btn_search = st.form_submit_button("SEARCH")
                with c2: btn_clear = st.form_submit_button("RESET")
            
            if btn_search:
                st.session_state.qry_hosp = s_hosp; st.session_state.qry_code = s_code; st.session_state.qry_key = s_key
                st.session_state.has_searched = True; st.rerun()
            if btn_clear:
                st.session_state.qry_hosp = []; st.session_state.qry_code = ""; st.session_state.qry_key = ""; st.session_state.has_searched = False; st.rerun()
        else:
            st.info("No database initialized.")

        st.markdown("---")
        
        # 資料維護區
        with st.expander("⚙️ Settings"):
            if st.button("Clear Database"):
                if clear_firebase_data(db):
                    load_data_from_firebase.clear()
                    st.session_state.data = None
                    st.success("資料庫已清除")
                    st.rerun()

            password = st.text_input("Key", type="password", placeholder="Upload Password")
            if password == "197": 
                uploaded_file = st.file_uploader("Upload Excel/CSV", type=['xlsx', 'csv'])
                if uploaded_file:
                    with st.spinner('Processing...'):
                        # 備份原始檔案到 Storage
                        file_bytes = uploaded_file.getvalue()
                        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
                        storage_path = upload_to_storage(
                            file_bytes, 
                            f"{timestamp}_{uploaded_file.name}"
                        )
                        
                        # 處理檔案
                        uploaded_file.seek(0)
                        if uploaded_file.name.endswith('.csv'):
                            try: df_raw = pd.read_csv(uploaded_file, header=None)
                            except: uploaded_file.seek(0); df_raw = pd.read_csv(uploaded_file, header=None, encoding='big5')
                        else: df_raw = pd.read_excel(uploaded_file, engine='openpyxl', header=None)
                        
                        clean_df, error = process_data(df_raw)
                        if clean_df is not None:
                            update_time = (datetime.utcnow() + timedelta(hours=8)).strftime("%Y-%m-%d %H:%M")
                            total_batches = math.ceil(len(clean_df) / BATCH_SIZE)
                            
                            if save_data_to_firebase(db, clean_df, update_time, storage_path):
                                load_data_from_firebase.clear()
                                st.session_state.data = clean_df
                                st.session_state.last_updated = update_time
                                st.success(f"✅ 已上傳 {len(clean_df)} 筆資料（分 {total_batches} 批存入）")
                                st.rerun()
                        else: 
                            st.error(error)

    # --- 主畫面 ---
    st.markdown('<div class="main-header">醫療產品查詢系統</div>', unsafe_allow_html=True)
    st.markdown('<div class="sub-header">Medical Product Database</div>', unsafe_allow_html=True)

    if st.session_state.data is not None and not st.session_state.data.empty:
        if st.session_state.has_searched:
            df = st.session_state.data
            filtered_df = df.copy()

            all_db_hospitals = df['醫院名稱'].unique().tolist()
            allowed_list = filter_hospitals(all_db_hospitals, MANAGER_HOSPITALS if st.session_state.is_manager_mode else PUBLIC_HOSPITALS)
            filtered_df = filtered_df[filtered_df['醫院名稱'].isin(allowed_list)]

            if st.session_state.qry_hosp: filtered_df = filtered_df[filtered_df['醫院名稱'].isin(st.session_state.qry_hosp)]
            if st.session_state.qry_code:
                k = st.session_state.qry_code.strip()
                filtered_df = filtered_df[filtered_df['院內碼'].str.contains(k, case=False, na=False) | filtered_df['批價碼'].str.contains(k, case=False, na=False) | filtered_df['原始備註'].str.contains(k, case=False, na=False)]
            if st.session_state.qry_key:
                kws = st.session_state.qry_key.split()
                for k in kws:
                    k_clean = re.sub(r'[^a-zA-Z0-9]', '', k)
                    m = filtered_df['搜尋用字串'].str.contains(k, case=False, na=False) | filtered_df['原始備註'].str.contains(k, case=False, na=False) | filtered_df['醫院名稱'].str.contains(k, case=False, na=False)
                    if k_clean: m = m | filtered_df['搜尋用字串'].str.contains(k_clean, case=False, na=False)
                    filtered_df = filtered_df[m]

            # 顯示結果
            if not filtered_df.empty:
                st.markdown(f"**Results:** {len(filtered_df)} items found")
                display_cols = ['醫院名稱', '產品名稱', '型號', '院內碼', '批價碼']
                
                styled_df = filtered_df[display_cols].style\
                    .set_properties(**{
                        'background-color': '#FFFFFF',
                        'color': '#4A4A4A',
                        'border-color': '#E0E0E0',
                        'font-family': "'Lato', sans-serif"
                    })\
                    .set_table_styles([
                        {'selector': 'th', 'props': [('background-color', '#F0EFEB'), ('color', '#2C3639'), ('font-family', "'Noto Serif TC', serif"), ('font-weight', 'bold'), ('border-bottom', '2px solid #6D8B74')]},
                        {'selector': 'td', 'props': [('padding', '12px 10px')]}
                    ])\
                    .applymap(lambda v: 'color: #6D8B74; font-weight: bold;', subset=['醫院名稱'])
                
                st.dataframe(styled_df, use_container_width=True, hide_index=True, height=700)
            else:
                st.markdown("""
                    <div style="text-align: center; padding: 50px; color: #888;">
                        <h3 style="color: #AAA;">NO RESULTS</h3>
                        <p>請嘗試更換關鍵字或選擇其他醫院</p>
                    </div>
                """, unsafe_allow_html=True)
        else:
            # 歡迎/引導畫面
            st.markdown("""
                <div style="background-color: #FFFFFF; padding: 40px; border-radius: 8px; border: 1px solid #EAEAEA; text-align: center;">
                    <h3 style="color: #6D8B74;">Welcome</h3>
                    <p style="color: #666; font-size: 14px; line-height: 1.6;">
                        請由左側選單選擇醫院或輸入關鍵字。<br>
                        支援型號、產品名稱與院內碼的複合搜尋。
                    </p>
                    <hr style="width: 50px; margin: 20px auto; border-top: 2px solid #E0E0E0;">
                </div>
            """, unsafe_allow_html=True)
    else:
        st.warning("⚠️ 請先於左側 Settings 上傳資料庫檔案")

if __name__ == "__main__":
    main()
