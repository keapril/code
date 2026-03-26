from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.chrome.service import Service
from webdriver_manager.chrome import ChromeDriverManager
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
import time
import sys

# 放 Streamlit 網址
URL = "https://southcode.streamlit.app/"

def keep_alive():
    options = Options()
    options.add_argument('--headless')
    options.add_argument('--no-sandbox')
    options.add_argument('--disable-dev-shm-usage')
    
    # 隱藏一些沒必要的 log
    options.add_argument("--log-level=3") 

    driver = None
    try:
        print(f"🌍 正在嘗試連線到 {URL} ...")
        
        # 自動下載並啟動 Chrome Driver
        service = Service(ChromeDriverManager().install())
        driver = webdriver.Chrome(service=service, options=options)
        
        # 開啟網站
        driver.get(URL)
        
        # 截圖以供除錯 (確認目前載入畫面)
        print("📸 正在擷取初始畫面截圖...")
        driver.save_screenshot("screenshot_initial.png")
        
        # 等待網頁載入（Streamlit 初始化 WebSocket 需要時間）
        print("⏳ 等待網頁與 WebSocket 載入 (15 秒)...")
        time.sleep(15)
        
        # 再次截圖確認載入後的狀態
        print("📸 正在擷取載入後畫面截圖...")
        driver.save_screenshot("screenshot_loaded.png")
        
        # 如果 Streamlit 進入休眠，可能會出現喚醒按鈕，這裡嘗試多種條件點擊它
        try:
            # 尋找 "Yes, get this app back up!" 按鈕或其他可能的休眠提示
            selectors = [
                 "//button[contains(., 'Yes, get this app back up')]", # 常見的舊版按鈕
                 "//button[contains(translate(., 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), 'wake')]", # 嘗試找尋 Wake up 相關按鈕
                 "//a[contains(translate(., 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), 'wake')]", # 或者連結
            ]
            
            button_clicked = False
            for selector in selectors:
               buttons = driver.find_elements(By.XPATH, selector)
               if buttons:
                   print(f"💤 發現休眠喚醒元素 ({selector})，準備點擊...")
                   buttons[0].click()
                   button_clicked = True
                   break
            
            if button_clicked:
                 print("✅ 已經點擊喚醒按鈕！")
                 time.sleep(10) # 點擊後再等一下讓他啟動
                 driver.save_screenshot("screenshot_after_wake.png")
            else:
                 print("ℹ️ 未發現喚醒按鈕，App 可能原本就是醒著的。")
                 
        except Exception as btn_e:
            print(f"ℹ️ 尋找喚醒按鈕時發生例外 (不影響心跳): {btn_e}")

        print("✅ 成功存取網頁，已送出心跳！")
        
    except Exception as e:
        print(f"⚠️ 發生錯誤: {e}")
        # 如果發生錯誤，也嘗試截圖
        if driver:
             try:
                 driver.save_screenshot("screenshot_error.png")
                 print("📸 已擷取錯誤畫面截圖。")
             except:
                 pass
        sys.exit(1)
    finally:
        if driver:
            driver.quit()

if __name__ == "__main__":
    keep_alive()
