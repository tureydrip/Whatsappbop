from flask import Flask, render_template, request, jsonify, send_file, send_from_directory
import yt_dlp
import os
import tempfile
import time
import shutil
import requests

app = Flask(__name__)

# Configuración de directorios temporales
TEMP_DIR = tempfile.gettempdir()
DOWNLOAD_DIR = os.path.join(TEMP_DIR, 'index99')
MEDIA_DIR = os.path.join(DOWNLOAD_DIR, 'media')
os.makedirs(DOWNLOAD_DIR, exist_ok=True)
os.makedirs(MEDIA_DIR, exist_ok=True)

TIKWM_API = "https://www.tikwm.com/api/"

def is_tiktok_url(url):
    return 'tiktok.com' in url.lower() or 'vm.tiktok.com' in url.lower()

def get_tiktok_info(url):
    try:
        response = requests.post(TIKWM_API, data={'url': url, 'hd': 1}, timeout=30)
        if response.status_code == 200:
            data = response.json()
            if data.get('code') == 0:
                return data.get('data')
        return None
    except Exception as e:
        print(f"Error en TIKWM API: {e}")
        return None

@app.route('/')
def index9():
    return render_template('index9.html')

@app.route('/media/<path:filename>')
def serve_media(filename):
    return send_from_directory(MEDIA_DIR, filename)

@app.route('/preview', methods=['POST'])
def preview():
    try:
        url = request.form.get('url', '').strip()
        if not url:
            return jsonify({'error': 'URL no proporcionada'}), 400

        timestamp = int(time.time() * 1000)

        if is_tiktok_url(url):
            tiktok_data = get_tiktok_info(url)
            if not tiktok_data:
                return jsonify({'error': 'No se pudo obtener información de TikTok'}), 500
            
            images = tiktok_data.get('images', [])
            if images:
                return jsonify({
                    'success': True, 'type': 'gallery', 'platform': 'tiktok',
                    'images': images, 'title': tiktok_data.get('title', 'Galería de TikTok'),
                    'thumbnail': images[0] if images else None, 'image_count': len(images),
                    'uploader': tiktok_data.get('author', {}).get('unique_id', 'Desconocido'),
                })
            else:
                video_url = tiktok_data.get('hdplay') or tiktok_data.get('play')
                cover = tiktok_data.get('cover')
                
                video_preview_path = None
                if video_url:
                    try:
                        preview_name = f'preview_tiktok_{timestamp}.mp4'
                        preview_path = os.path.join(MEDIA_DIR, preview_name)
                        video_response = requests.get(video_url, timeout=60, stream=True)
                        if video_response.status_code == 200:
                            with open(preview_path, 'wb') as f:
                                for chunk in video_response.iter_content(chunk_size=8192):
                                    f.write(chunk)
                            video_preview_path = f'/media/{preview_name}'
                    except Exception as e:
                        print(e)
                
                audio_preview_path = None
                music_url = tiktok_data.get('music_info', {}).get('play')
                if music_url:
                    try:
                        audio_name = f'preview_tiktok_audio_{timestamp}.mp3'
                        audio_path = os.path.join(MEDIA_DIR, audio_name)
                        audio_response = requests.get(music_url, timeout=30)
                        if audio_response.status_code == 200:
                            with open(audio_path, 'wb') as f:
                                f.write(audio_response.content)
                            audio_preview_path = f'/media/{audio_name}'
                    except Exception as e:
                        print(e)
                
                return jsonify({
                    'success': True, 'type': 'video', 'platform': 'tiktok',
                    'title': tiktok_data.get('title', 'Video de TikTok'), 'thumbnail': cover,
                    'video_url': video_preview_path, 'audio_url': audio_preview_path,
                    'duration': tiktok_data.get('duration', 0),
                    'uploader': tiktok_data.get('author', {}).get('unique_id', 'Desconocido'),
                    'view_count': tiktok_data.get('play_count', 0),
                })

        ydl_opts = {'quiet': True, 'no_warnings': True, 'extract_flat': False}
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=False)
            thumbnails = info.get('thumbnails', [])
            thumbnail = thumbnails[-1]['url'] if thumbnails else info.get('thumbnail')

            video_preview_path = None
            try:
                preview_name = f'preview_video_{timestamp}'
                ydl_preview = {
                    'format': 'worst[ext=mp4]/worst',
                    'outtmpl': os.path.join(MEDIA_DIR, f'{preview_name}.%(ext)s'),
                    'quiet': True, 'no_warnings': True,
                }
                with yt_dlp.YoutubeDL(ydl_preview) as ydl2:
                    ydl2.download([url])
                for file in os.listdir(MEDIA_DIR):
                    if file.startswith(preview_name):
                        video_preview_path = f'/media/{file}'
                        break
            except Exception as e:
                print(e)

            audio_preview_path = None
            try:
                audio_name = f'preview_audio_{timestamp}'
                ydl_audio_preview = {
                    'format': 'bestaudio/best',
                    'outtmpl': os.path.join(MEDIA_DIR, f'{audio_name}.%(ext)s'),
                    'postprocessors': [{'key': 'FFmpegExtractAudio', 'preferredcodec': 'mp3', 'preferredquality': '64'}],
                    'quiet': True, 'no_warnings': True,
                }
                with yt_dlp.YoutubeDL(ydl_audio_preview) as ydl3:
                    ydl3.download([url])
                for file in os.listdir(MEDIA_DIR):
                    if file.startswith(audio_name) and file.endswith('.mp3'):
                        audio_preview_path = f'/media/{file}'
                        break
            except Exception as e:
                print(e)

            return jsonify({
                'success': True, 'type': 'video', 'platform': 'other',
                'title': info.get('title', 'Sin título'), 'thumbnail': thumbnail,
                'video_url': video_preview_path, 'audio_url': audio_preview_path,
                'duration': info.get('duration'), 'uploader': info.get('uploader', 'Desconocido'),
                'view_count': info.get('view_count'),
            })

    except Exception as e:
        return jsonify({'error': f'Error: {str(e)}'}), 500

@app.route('/download', methods=['POST'])
def download():
    try:
        url = request.form.get('url', '').strip()
        kind = request.form.get('kind', 'video')

        if not url:
            return jsonify({'error': 'URL no proporcionada'}), 400

        timestamp = int(time.time() * 1000)

        if is_tiktok_url(url):
            tiktok_data = get_tiktok_info(url)
            if not tiktok_data:
                return jsonify({'error': 'No se pudo obtener información de TikTok'}), 500
            
            if kind == 'gallery':
                images = tiktok_data.get('images', [])
                if not images:
                    return jsonify({'error': 'No se encontraron imágenes'}), 404
                
                import zipfile
                zip_filename = f'luck_xit_tiktok_gallery_{timestamp}.zip'
                zip_path = os.path.join(DOWNLOAD_DIR, zip_filename)
                
                with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as zipf:
                    for idx, img_url in enumerate(images, 1):
                        try:
                            img_response = requests.get(img_url, timeout=30)
                            if img_response.status_code == 200:
                                zipf.writestr(f'imagen_{idx:03d}.jpg', img_response.content)
                        except Exception as e:
                            print(e)
                
                return send_file(zip_path, mimetype='application/zip', as_attachment=True, download_name=zip_filename)
            
            elif kind == 'video':
                video_url = tiktok_data.get('hdplay') or tiktok_data.get('play')
                if not video_url:
                    return jsonify({'error': 'No se encontró URL del video'}), 404
                
                video_filename = f'luck_xit_tiktok_{timestamp}.mp4'
                video_path = os.path.join(DOWNLOAD_DIR, video_filename)
                
                video_response = requests.get(video_url, timeout=120, stream=True)
                if video_response.status_code == 200:
                    with open(video_path, 'wb') as f:
                        for chunk in video_response.iter_content(chunk_size=8192):
                            f.write(chunk)
                    return send_file(video_path, mimetype='video/mp4', as_attachment=True, download_name=video_filename)
            
            elif kind == 'audio':
                music_url = tiktok_data.get('music_info', {}).get('play')
                if not music_url:
                    return jsonify({'error': 'No se encontró audio'}), 404
                
                audio_filename = f'luck_xit_tiktok_audio_{timestamp}.mp3'
                audio_path = os.path.join(DOWNLOAD_DIR, audio_filename)
                
                audio_response = requests.get(music_url, timeout=60)
                if audio_response.status_code == 200:
                    with open(audio_path, 'wb') as f:
                        f.write(audio_response.content)
                    return send_file(audio_path, mimetype='audio/mpeg', as_attachment=True, download_name=audio_filename)

        output_template = os.path.join(DOWNLOAD_DIR, f'luck_xit_{timestamp}.%(ext)s')

        if kind == 'audio':
            ydl_opts = {
                'format': 'bestaudio/best',
                'outtmpl': output_template,
                'postprocessors': [{'key': 'FFmpegExtractAudio', 'preferredcodec': 'mp3', 'preferredquality': '192'}],
                'quiet': True, 'no_warnings': True,
            }
            file_extension = 'mp3'
            mimetype = 'audio/mpeg'
        else:
            ydl_opts = {
                'format': 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best',
                'outtmpl': output_template,
                'quiet': True, 'no_warnings': True,
                'merge_output_format': 'mp4',
            }
            file_extension = 'mp4'
            mimetype = 'video/mp4'

        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            ydl.download([url])

        downloaded_file = None
        for file in os.listdir(DOWNLOAD_DIR):
            if file.startswith(f'luck_xit_{timestamp}') and file.endswith(f'.{file_extension}'):
                downloaded_file = os.path.join(DOWNLOAD_DIR, file)
                break

        if not downloaded_file or not os.path.exists(downloaded_file):
            return jsonify({'error': 'Error al descargar el archivo'}), 500

        download_name = f'luck_xit_{kind}_{timestamp}.{file_extension}'
        return send_file(downloaded_file, mimetype=mimetype, as_attachment=True, download_name=download_name)

    except Exception as e:
        return jsonify({'error': f'Error en la descarga: {str(e)}'}), 500

@app.route('/health')
def health():
    return jsonify({'status': 'ok', 'message': 'LUCK XIT Server Running'})

def cleanup_temp_files():
    try:
        for d in [DOWNLOAD_DIR, MEDIA_DIR]:
            for file in os.listdir(d):
                file_path = os.path.join(d, file)
                if os.path.isfile(file_path):
                    os.remove(file_path)
    except Exception as e:
        print(f"Error limpiando archivos: {e}")

if __name__ == '__main__':
    cleanup_temp_files()
    # Usar puerto dinámico para Railway
    port = int(os.environ.get("PORT", 8080))
    app.run(host='0.0.0.0', port=port, debug=False)
