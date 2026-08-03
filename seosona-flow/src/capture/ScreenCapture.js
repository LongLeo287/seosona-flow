/**
 * ScreenCapture - Q2 Screen Capture Feature
 *
 * Chụp vùng chọn trên BẤT KỲ trang web nào, crop và lưu làm ảnh ref.
 * Yêu cầu: Có ít nhất 1 tab Google Flow đang mở (để upload ảnh sau đó).
 *
 * Flow:
 * 1. Click nút "Chụp màn hình" → startCapture()
 * 2. background.js inject overlay vào tab đang active (bất kỳ trang nào)
 * 3. User kéo chọn vùng → click "Chụp" → trả về cropRect
 * 4. background.js capture tab → dataUrl
 * 5. ScreenCapture.cropImage() cắt ảnh theo cropRect → File object
 * 6. Thêm vào pendingUploadFiles + PendingUploadStore → renderFileIdThumbnails
 */
class ScreenCapture {
  /**
   * Bắt đầu quá trình chụp màn hình
   * @returns {Promise<{success: boolean, uploadId?: string, error?: string}>}
   */
  static async startCapture() {
    try {
      // Step 1: Show crop overlay on the active tab (any page) via background.js
      console.log('[ScreenCapture] Hiển thị overlay chọn vùng trên tab hiện tại...');

      const cropResult = await this._startCropOnActiveTab();

      // Handle openFlow action
      if (cropResult.action === 'openFlow') {
        const shouldOpen = await this._showOpenFlowDialog(cropResult.error);
        if (shouldOpen) {
          chrome.runtime.sendMessage({ action: 'openFlowTab' });
        }
        return { success: false, cancelled: true };
      }

      if (!cropResult.success) {
        if (cropResult.cancelled) {
          console.log('[ScreenCapture] Đã hủy chụp màn hình');
          return { success: false, cancelled: true };
        }
        throw new Error(cropResult.error || window.I18n?.t('capture.errorCropFailed') || 'Không thể chọn vùng');
      }

      // Step 2: Capture full tab via background.js (after user selected area)
      console.log('[ScreenCapture] Chụp màn hình tab...');
      const captureResult = await this._captureScreen();
      if (!captureResult.success) {
        throw new Error(captureResult.error || window.I18n?.t('capture.errorCaptureFailed') || 'Không thể chụp màn hình');
      }

      // S7: Lấy tên ảnh từ crop result (user nhập trong overlay)
      const captureName = cropResult.captureName || ('capture_' + Date.now().toString(36));

      // Step 3: Crop image using the selection rect
      console.log('[ScreenCapture] Đang cắt ảnh...', cropResult.cropRect, 'Tên:', captureName);
      const croppedFile = await this._cropImage(captureResult.dataUrl, cropResult.cropRect, captureName);

      // Step 4: Add to pendingUploadFiles
      const uploadId = 'upload_capture_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
      const thumbnail = await this._fileToDataUrl(croppedFile);

      if (!window.pendingUploadFiles) window.pendingUploadFiles = new Map();
      window.pendingUploadFiles.set(uploadId, {
        file: croppedFile,
        thumbnail,
        name: captureName,
        timestamp: Date.now()
      });

      // S2: Upload ngay nếu Flow tab mở, hoặc lưu lightweight pending
      // KHÔNG await — để GenTab kịp thêm uploadId vào fileIds trước khi upload:completed fire
      if (window.ImmediateUploader) {
        ImmediateUploader.upload(croppedFile, thumbnail, { key: uploadId, name: captureName });
      } else if (window.PendingUploadStore) {
        await PendingUploadStore.saveLightweight(uploadId, { thumbnail, fileName: croppedFile.name, fileSize: croppedFile.size, fileType: croppedFile.type, name: captureName });
      }

      // S7.4: Register name vào ImageNameRegistry để dùng cho @mention
      if (window.imageNameRegistry) {
        window.imageNameRegistry.register(captureName, {
          type: 'capture',
          source: 'capture',
          uploadId,
          thumbnail,
          blob_url: thumbnail
        });
        console.log('[ScreenCapture] Đã đăng ký @' + captureName + ' vào registry');
      }

      console.log('[ScreenCapture] Đã thêm ảnh capture:', uploadId, 'Tên:', captureName);
      return { success: true, uploadId, captureName };

    } catch (err) {
      console.error('[ScreenCapture] Lỗi:', err.message);
      return { success: false, error: err.message };
    }
  }

  /**
   * Gửi yêu cầu chụp màn hình đến background.js
   * @private
   */
  static async _captureScreen() {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ action: 'captureScreen' }, async (response) => {
        if (chrome.runtime.lastError) {
          resolve({ success: false, error: chrome.runtime.lastError.message });
          return;
        }

        // Handle 'openFlow' action - show dialog to open Flow
        if (response?.action === 'openFlow') {
          const shouldOpen = await this._showOpenFlowDialog(response.error);
          if (shouldOpen) {
            chrome.runtime.sendMessage({ action: 'openFlowTab' });
          }
          resolve({ success: false, cancelled: true });
          return;
        }

        // Handle 'requestCapturePermission' action - need user to grant permission
        if (response?.action === 'requestCapturePermission') {
          const shouldGrant = await this._showPermissionDialog();
          if (shouldGrant) {
            // Request permission DIRECTLY from sidebar context (requires user gesture)
            // chrome.permissions.request() MUST be called from user gesture context, not background.js
            try {
              const granted = await chrome.permissions.request({ origins: ['<all_urls>'] });
              console.log('[ScreenCapture] Permission request result:', granted);
              if (granted) {
                // Permission granted, retry capture
                console.log('[ScreenCapture] Permission granted, retrying capture...');
                chrome.runtime.sendMessage({ action: 'captureScreen' }, (retryResponse) => {
                  resolve(retryResponse || { success: false, error: 'Retry failed' });
                });
                return;
              }
            } catch (permErr) {
              console.error('[ScreenCapture] Permission request error:', permErr);
            }
          }
          resolve({ success: false, cancelled: true, error: window.I18n?.t('capture.errorNeedPermission') || 'Cần cấp quyền để chụp màn hình' });
          return;
        }

        resolve(response || { success: false, error: window.I18n?.t('capture.errorNoResponse') || 'Không có phản hồi' });
      });
    });
  }

  /**
   * Show dialog asking user to grant capture permission
   * @private
   */
  static async _showPermissionDialog() {
    if (!window.customDialog) return false;
    return await window.customDialog.confirm(
      window.I18n?.t('capture.permissionMsg') || 'Để chụp màn hình từ trang này, bạn cần cấp quyền truy cập. Quyền này chỉ dùng để chụp ảnh và sẽ được lưu cho các lần sau.',
      {
        title: window.I18n?.t('capture.permissionTitle') || 'Cấp quyền chụp màn hình',
        type: 'info',
        confirmText: window.I18n?.t('capture.grantPermission') || 'Cấp quyền',
        cancelText: window.I18n?.t('common.cancel') || 'Hủy'
      }
    );
  }

  /**
   * Show dialog asking user to open Flow
   * @private
   */
  static async _showOpenFlowDialog(message) {
    if (!window.customDialog) return false;
    return await window.customDialog.confirm(
      message || window.I18n?.t('capture.openFlowMsg') || 'Chưa mở Google Flow. Cần mở labs.google/fx để upload ảnh chụp.',
      {
        title: window.I18n?.t('capture.openFlowTitle') || 'Mở Google Flow',
        type: 'info',
        confirmText: window.I18n?.t('capture.openFlowConfirm') || 'Mở Flow',
        cancelText: window.I18n?.t('common.cancel') || 'Hủy'
      }
    );
  }

  /**
   * Inject crop overlay vào tab đang active (bất kỳ trang nào)
   * @private
   */
  static async _startCropOnActiveTab() {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ action: 'startCropOnActiveTab' }, (response) => {
        if (chrome.runtime.lastError) {
          resolve({ success: false, error: chrome.runtime.lastError.message });
          return;
        }
        resolve(response || { success: false, error: window.I18n?.t('capture.errorNoResponse') || 'Không có phản hồi' });
      });
    });
  }

  /**
   * Crop ảnh từ dataURL theo cropRect
   * @private
   * @param {string} dataUrl - Full screenshot dataURL
   * @param {Object} cropRect - {x, y, width, height} tính theo devicePixelRatio
   * @param {string} [captureName] - Tên ảnh (dùng cho filename)
   * @returns {Promise<File>}
   */
  static async _cropImage(dataUrl, cropRect, captureName) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = cropRect.width;
        canvas.height = cropRect.height;

        const ctx = canvas.getContext('2d');
        ctx.drawImage(
          img,
          cropRect.x, cropRect.y, cropRect.width, cropRect.height,
          0, 0, cropRect.width, cropRect.height
        );

        canvas.toBlob((blob) => {
          if (!blob) {
            reject(new Error(window.I18n?.t('capture.errorBlobFailed') || 'Không thể tạo blob từ canvas'));
            return;
          }
          // S7: Dùng captureName cho filename (đã sanitize ở background.js)
          const fileName = captureName ? `${captureName}.png` : `capture_${Date.now()}.png`;
          const file = new File([blob], fileName, { type: 'image/png' });
          resolve(file);
        }, 'image/png');
      };

      img.onerror = () => {
        reject(new Error(window.I18n?.t('capture.errorLoadFailed') || 'Không thể load ảnh screenshot'));
      };

      img.src = dataUrl;
    });
  }

  /**
   * Convert File to dataURL for thumbnail preview
   * @private
   */
  static async _fileToDataUrl(file) {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => resolve('');
      reader.readAsDataURL(file);
    });
  }
}

window.ScreenCapture = ScreenCapture;
