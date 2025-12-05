import streamlit as st
import pandas as pd
import re
import os
import pickle
from datetime import datetime
import time

# --- 1. 設定頁面配置 ---
st.set_page_config(page_title="醫療產品查詢系統", layout="wide", page_icon="🏥")

# --- 2. 設定：醫院白名單設定 ---

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
# 修正：加入 "國立陽明大學" 等精確全名
MANAGER_HOSPITALS = [
    "新店慈濟", "台北慈濟", 
    "內湖三總", "三軍總醫院", 
    "松山三總", "松山分院", 
    "國立陽明大學", "國立陽明交通大學附設醫院", "國立陽明", # 確保抓到
    "輔大", "羅東博愛", 
    "衛生福利部臺北醫院", "部立臺北"
]

ALL_VALID_HOSPITALS = PUBLIC_HOSPITALS + MANAGER_HOSPITALS

# CSS 樣式優化
st.markdown("""
    <style>
    /* 全局淺色設定 */
    [data-testid="stAppViewContainer"] { background-color: #F5F7F9 !important; color: #2C3E50 !important; }
    [data-testid="stSidebar"] { background-color: #FFFFFF !important; border-right: 1px solid #E0E0E0; }
    h1, h2, h3, h4, h5, h6, p, span, label, div { color: #2C3E50 !important; font-family: sans-serif; }
    
    /* 輸入框與選單 */
    .stTextInput input, .stMultiSelect div[data-baseweb="select"] > div, .stSelectbox div[data-baseweb="select"] > div {
        background-color: #FFFFFF !important;
        border: 1px solid #D0D0D0 !important;
        color: #2C3E50 !important;
    }
    
    /* 表格 */
    .stDataFrame { background-color: #FFFFFF !important; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.05); }
    
    /* 按鈕樣式 (白底灰字) */
    div[data-testid="stForm"] button {
        background-color: #FFFFFF !important;
        color: #555555 !important;
        border: 1px solid #CCCCCC !important;
        width: 100%;
        font-weight: bold;
        padding: 10px;
        border-radius: 5px;
        transition: 0.2s;
        box-shadow: 0 1px 2px rgba(0,0,0,0.05);
    }
    div[data-testid="stForm"] button:hover {
        background-color: #F0F0F0 !important;
        border-color: #999999 !important;
        color: #333333 !important;
    }
    
    #MainMenu {visibility: hidden;}
    footer {visibility: hidden;}
    </style>
""", unsafe_allow_html=True)

# 資料庫路徑
DB_FILE = 'local_database.pkl'

# --- 3. 資料處理核心邏輯 ---
def process_data(df):
    try:
        # 基礎清理
        df = df.dropna(how='all').dropna(axis=1, how='all').reset_index(drop=True)
        df = df.astype(str).apply(lambda x: x.str.strip())
        
        # 自動偵測標題列
        header_col_idx = -1
        # 掃描前15欄，找包含"型號"的列
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
                # 1. 精確比對
                matches = header_col_data[header_col_data == kw]
                if not matches.empty: return matches.index[0]
                # 2. 去空白後比對
                matches = header_col_data[header_col_data.str.replace(' ', '') == kw]
                if not matches.empty: return matches.index[0]
                # 3. 包含比對
                matches = header_col_data[header_col_data.str.contains(kw, na=False) & (header_col_data.str.len() < 20)]
                if not matches.empty: return matches.index[0]
            return None

        # 抓取關鍵列
        idx_model = find_row_index('型號')
        idx_alias = find_row_index(['客戶簡稱', '產品名稱', '品名']) 
        idx_nhi_code = find_row_index(['健保碼', '自費碼', '健保碼(自費碼)'])
        idx_permit = find_row_index('許可證')
        
        if idx_model is None:
            return None, "錯誤：找不到『型號』列。"

        # 建構產品清單
        products = {}
        total_cols = df.shape[1]
        
        for col_idx in range(header_col_idx + 1, total_cols):
            model_val = df.iloc[idx_model, col_idx]
            
            if (model_val == '' or model_val.lower() == 'nan' or 
                '祐新' in model_val or '銀鐸' in model_val or len(model_val) > 50):
                continue
            
            alias_val = df.iloc[idx_alias, col_idx] if idx_alias is not None else ''
            nhi_val = df.iloc[idx_nhi_code, col_idx] if idx_nhi_code is not None else ''
            permit_val = df.iloc[idx_permit, col_idx] if idx_permit is not None else ''
            
            model_clean = re.sub(r'[^a-zA-Z0-9]', '', str(model_val))
            full_search_text = f"{model_val} {model_clean} {alias_val} {nhi_val} {permit_val}".lower()

            products[col_idx] = {
                '型號': model_val,
                '產品名稱': alias_val,
                '健保碼': nhi_val,
                '搜尋用字串': full_search_text
            }
        
        known_indices = [i for i in [idx_model, idx_alias, idx_nhi_code, idx_permit] if i is not None]
        exclude_keys = ['效期', 'QSD', '產地', 'Code', 'Listing', 'None', 'Hospital', 'source', '備註', '健保價', '許可證']
        
        processed_list = []

        for row_idx, row in df.iterrows():
            row_header = str(row.iloc[header_col_idx])
            
            if row_idx in known_indices: continue
            if row_header == '' or row_header.lower() == 'nan': continue
            if any(k in row_header for k in exclude_keys): continue
            
            # === 醫院白名單過濾 ===
            hospital_name = row_header.strip()
            is_valid = False
            
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
                
                if cell_content and cell_content.lower() != 'nan' and len(cell_content) > 1:
                    
                    # 抓取所有 #Code
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
                        # === 特殊邏輯 1：台南市立(秀傳) ===
                        if "台南市立" in hospital_name or "秀傳" in hospital_name:
                            hosp_codes = [] # 院內碼 (#B開頭)
                            bill_codes = [] # 批價碼 (其他英文開頭)
                            spec_model_update = None # 型號 (#數字開頭)
                            
                            for code in all_matches:
                                clean_code = code.replace('#', '').strip()
                                
                                if clean_code.upper().startswith('B'):
                                    hosp_codes.append(clean_code)
                                elif clean_code[0].isdigit(): 
                                    # #數字開頭 -> 視為特定型號
                                    spec_model_update = clean_code
                                else:
                                    # 其他英文開頭 -> 視為批價碼
                                    bill_codes.append(clean_code)
                            
                            # 合併為一列 (一個產品一列)
                            new_item = base_item.copy()
                            new_item['院內碼'] = ", ".join(hosp_codes) if hosp_codes else ""
                            new_item['批價碼'] = ", ".join(bill_codes) if bill_codes else ""
                            
                            if spec_model_update:
                                new_item['型號'] = spec_model_update
                                new_item['搜尋用字串'] += f" {spec_model_update}"

                            # 只要有任何碼就加入
                            if new_item['院內碼'] or new_item['批價碼'] or spec_model_update:
                                processed_list.append(new_item)
                            else:
                                processed_list.append(base_item)
                                
                        else:
                            # === 一般邏輯 (中國安南等)：檢查括號內的型號 ===
                            # 重新抓取包含括號的模式
                            pattern_with_spec = r'(#\s*[A-Za-z0-9\-\.\_]+)(?:\s*[\n\r]*\(([^)]+)\))?'
                            matches_with_spec = re.findall(pattern_with_spec, cell_content)
                            
                            if matches_with_spec:
                                for code_raw, spec_text in matches_with_spec:
                                    new_item = base_item.copy()
                                    new_item['院內碼'] = code_raw.replace('#', '').strip()
                                    
                                    # 中國安南規則：如果有括號內容 (且不是日期或議價)，視為型號
                                    if spec_text:
                                        spec_text = spec_text.strip()
                                        exclude_spec = ['議價', '生效', '發票', '稅', '折讓', '贈', '單', '訂單', '通知', '健保', '關碼', '停用', '缺貨', '取代', '急採', '收費', '月', '年', '日', '/']
                                        if not any(k in spec_text for k in exclude_spec) and len(spec_text) < 50:
                                            # 取出括號內的型號，更新該筆資料
                                            # 只取第一段文字 (避免抓到後面可能有的日期)
                                            pure_spec = spec_text.split()[0]
                                            new_item['型號'] = pure_spec
                                            new_item['搜尋用字串'] += f" {pure_spec.lower()}"
                                    
                                    processed_list.append(new_item)
                            else:
                                # 如果 regex 沒抓到括號模式，就用簡單模式抓代碼
                                for code in all_matches:
                                    new_item = base_item.copy()
                                    new_item['院內碼'] = code.replace('#', '').strip()
                                    processed_list.append(new_item)
                    else:
                        # 沒抓到 #碼 也要保留顯示
                        processed_list.append(base_item)

        return pd.DataFrame(processed_list), None

    except Exception as e:
        return None, f"處理錯誤: {str(e)}"

def save_data(data_dict):
    with open(DB_FILE, 'wb') as f: pickle.dump(data_dict, f)

@st.cache_data(ttl=3600, show_spinner=False)
def load_data_cached(mtime):
    if os.path.exists(DB_FILE):
        with open(DB_FILE, 'rb') as f: return pickle.load(f)
    return None

def get_data():
    if os.path.exists(DB_FILE):
        return load_data_cached(os.path.getmtime(DB_FILE))
    return None

def filter_hospitals(all_hospitals, allow_list):
    filtered = []
    for h in all_hospitals:
        for allow in allow_list:
            # 特殊處理：陽明大學 (精確比對，避免抓到北市聯醫)
            if "陽明" in allow:
                if "陽明大學" in h or "陽明交通" in h or "國立陽明" in h:
                    if "聯醫" not in h: # 排除北市聯醫
                        filtered.append(h)
                        break
                continue
            
            # 一般比對：包含且長度>1
            if allow == h or (len(allow) > 1 and allow in h):
                filtered.append(h)
                break
    return sorted(list(set(filtered)))

# --- 4. 主程式 ---
def main():
    db_content = get_data()
    
    if isinstance(db_content, pd.DataFrame):
        st.session_state.data = db_content
        st.session_state.last_updated = "未知"
    elif isinstance(db_content, dict):
        st.session_state.data = db_content.get('df')
        st.session_state.last_updated = db_content.get('updated_at', "未知")
    else:
        st.session_state.data = None
        st.session_state.last_updated = ""

    if 'has_searched' not in st.session_state: st.session_state.has_searched = False
    if 'qry_hosp' not in st.session_state: st.session_state.qry_hosp = []
    if 'qry_code' not in st.session_state: st.session_state.qry_code = ""
    if 'qry_key' not in st.session_state: st.session_state.qry_key = ""
    
    if 'is_manager_mode' not in st.session_state: st.session_state.is_manager_mode = False
    if 'select_mode' not in st.session_state: st.session_state.select_mode = "single"

    # --- 側邊欄 ---
    with st.sidebar:
        st.title("🔍 查詢條件")
        
        if st.session_state.last_updated:
            st.caption(f"📅 資料更新：{st.session_state.last_updated}")
        
        # --- 噥噥專用解鎖開關 ---
        show_manager = st.checkbox("🔓 噥噥專用", value=st.session_state.is_manager_mode)
        
        if show_manager and not st.session_state.is_manager_mode:
            m_pwd = st.text_input("請輸入密碼", type="password", key="manager_pwd_input")
            if m_pwd == "163": 
                st.session_state.is_manager_mode = True
                st.success("噥噥模式已啟用")
                time.sleep(0.5)
                st.rerun()
            elif m_pwd:
                st.error("密碼錯誤")
        elif not show_manager and st.session_state.is_manager_mode:
             st.session_state.is_manager_mode = False
             st.rerun()

        st.markdown("---")

        if st.session_state.data is not None:
            df = st.session_state.data
            all_db_hospitals = df['醫院名稱'].unique().tolist()
            
            if st.session_state.is_manager_mode:
                display_hosp_list = filter_hospitals(all_db_hospitals, MANAGER_HOSPITALS)
            else:
                display_hosp_list = filter_hospitals(all_db_hospitals, PUBLIC_HOSPITALS)
            
            mode = st.radio("選擇醫院模式", ["單選 (自動收合)", "多選 (比較用)"], index=0, horizontal=True)
            
            with st.form("search_form"):
                if "單選" in mode:
                    hosp_options = ["(全部)"] + display_hosp_list
                    default_idx = 0
                    if st.session_state.qry_hosp and len(st.session_state.qry_hosp) == 1:
                        if st.session_state.qry_hosp[0] in hosp_options:
                            default_idx = hosp_options.index(st.session_state.qry_hosp[0])
                    s_hosp_single = st.selectbox("🏥 選擇醫院", options=hosp_options, index=default_idx)
                    s_hosp = [s_hosp_single] if s_hosp_single != "(全部)" else []
                else:
                    default_opts = [h for h in st.session_state.qry_hosp if h in display_hosp_list]
                    s_hosp = st.multiselect("🏥 選擇醫院", options=display_hosp_list, default=default_opts)
                
                s_code = st.text_input("🔢 院內碼", value=st.session_state.qry_code)
                s_key = st.text_input("🔎 關鍵字 (型號/產品名)", value=st.session_state.qry_key)
                
                st.markdown("---")
                
                c1, c2 = st.columns(2)
                with c1:
                    btn_search = st.form_submit_button("🔍 查詢")
                with c2:
                    btn_clear = st.form_submit_button("❌ 清除")
            
            if btn_search:
                st.session_state.qry_hosp = s_hosp
                st.session_state.qry_code = s_code
                st.session_state.qry_key = s_key
                st.session_state.has_searched = True
                st.rerun()
            
            if btn_clear:
                st.session_state.qry_hosp = []
                st.session_state.qry_code = ""
                st.session_state.qry_key = ""
                st.session_state.has_searched = False
                st.rerun()
        else:
            st.info("系統無資料")

        st.markdown("---")
        
        show_admin_upload = st.checkbox("我是資料維護員 (上傳)")
        if show_admin_upload:
            with st.expander("⚙️ 後台資料更新", expanded=True):
                if st.button("🗑️ 清除舊資料庫 (重置)"):
                    if os.path.exists(DB_FILE):
                        os.remove(DB_FILE)
                        load_data_cached.clear()
                        st.session_state.data = None
                        st.session_state.last_updated = ""
                        st.session_state.has_searched = False
                        st.success("已清除，請重新上傳。")
                        time.sleep(1)
                        st.rerun()

                password = st.text_input("維護密碼", type="password")
                if password == "197": 
                    uploaded_file = st.file_uploader("上傳 Excel 或 CSV", type=['xlsx', 'csv'])
                    if uploaded_file:
                        with st.spinner('處理中...'):
                            if uploaded_file.name.endswith('.csv'):
                                try:
                                    df_raw = pd.read_csv(uploaded_file, header=None)
                                except:
                                    uploaded_file.seek(0)
                                    df_raw = pd.read_csv(uploaded_file, header=None, encoding='big5')
                            else:
                                df_raw = pd.read_excel(uploaded_file, engine='openpyxl', header=None)
                                
                            clean_df, error = process_data(df_raw)
                            if clean_df is not None:
                                update_time = datetime.now().strftime("%Y-%m-%d %H:%M")
                                save_data({'df': clean_df, 'updated_at': update_time})
                                load_data_cached.clear()
                                
                                st.session_state.data = clean_df
                                st.session_state.last_updated = update_time
                                st.success(f"成功！匯入 {len(clean_df)} 筆資料。")
                                time.sleep(1)
                                st.rerun()
                            else:
                                st.error(error)

    # --- 主畫面 ---
    st.header("醫療產品資料庫")

    if st.session_state.data is not None:
        if st.session_state.has_searched:
            df = st.session_state.data
            filtered_df = df.copy()

            all_db_hospitals = df['醫院名稱'].unique().tolist()
            if st.session_state.is_manager_mode:
                allowed_list = filter_hospitals(all_db_hospitals, MANAGER_HOSPITALS)
            else:
                allowed_list = filter_hospitals(all_db_hospitals, PUBLIC_HOSPITALS)
                
            filtered_df = filtered_df[filtered_df['醫院名稱'].isin(allowed_list)]

            if st.session_state.qry_hosp:
                filtered_df = filtered_df[filtered_df['醫院名稱'].isin(st.session_state.qry_hosp)]
            
            if st.session_state.qry_code:
                k = st.session_state.qry_code.strip()
                m1 = filtered_df['院內碼'].str.contains(k, case=False, na=False)
                m2 = filtered_df['批價碼'].str.contains(k, case=False, na=False)
                m3 = filtered_df['原始備註'].str.contains(k, case=False, na=False)
                filtered_df = filtered_df[m1 | m2 | m3]
            
            if st.session_state.qry_key:
                kws = st.session_state.qry_key.split()
                for k in kws:
                    k_clean = re.sub(r'[^a-zA-Z0-9]', '', k)
                    m_search = filtered_df['搜尋用字串'].str.contains(k, case=False, na=False)
                    if k_clean:
                        m_search = m_search | filtered_df['搜尋用字串'].str.contains(k_clean, case=False, na=False)
                    m_note = filtered_df['原始備註'].str.contains(k, case=False, na=False)
                    m_hosp = filtered_df['醫院名稱'].str.contains(k, case=False, na=False)
                    filtered_df = filtered_df[m_search | m_note | m_hosp]

            st.caption(f"搜尋結果：{len(filtered_df)} 筆")
            
            if not filtered_df.empty:
                display_cols = ['醫院名稱', '產品名稱', '型號', '院內碼', '批價碼']
                st.dataframe(
                    filtered_df[display_cols].style.map(
                        lambda _: 'background-color: #f8f8ff; color: black; font-weight: bold;', 
                        subset=['醫院名稱']
                    ),
                    use_container_width=True, 
                    hide_index=True, 
                    height=700
                )
            else:
                st.warning("❌ 找不到資料")
        else:
            st.info("👈 請在左側輸入條件，並點擊「查詢」按鈕。")
    else:
        st.warning("⚠️ 請先在左側後台區上傳資料。")

if __name__ == "__main__":
    main()
