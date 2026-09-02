import sys
import os
import json
import yt_dlp

def search_youtube(query, max_results=8):
    ydl_opts = {
        'extract_flat': True,
        'skip_download': True,
        'quiet': True,
        'no_warnings': True,
    }
    
    search_term = f"ytsearch{max_results}:{query}"
    results = []
    
    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        try:
            info = ydl.extract_info(search_term, download=False)
            if 'entries' in info:
                for entry in info['entries']:
                    if not entry:
                        continue
                    sec = entry.get('duration', 0) or 0
                    mins = int(sec // 60)
                    remainder_sec = int(sec % 60)
                    dur_str = f"{mins}:{remainder_sec:02d}" if sec > 0 else "Karaoke"
                    
                    vid_id = entry.get('id', '')
                    results.append({
                        'id': vid_id,
                        'title': entry.get('title', 'YouTube Video'),
                        'channel': entry.get('uploader', 'YouTube'),
                        'duration': dur_str,
                        'thumbnail': f"https://i.ytimg.com/vi/{vid_id}/hqdefault.jpg",
                        'url': f"https://www.youtube.com/watch?v={vid_id}"
                    })
        except Exception as e:
            print(f"Error searching YouTube: {e}", file=sys.stderr)
            
    return results

def download_audio(video_id_or_url, output_path):
    if not video_id_or_url.startswith('http'):
        url = f"https://www.youtube.com/watch?v={video_id_or_url}"
    else:
        url = video_id_or_url
        
    out_dir = os.path.dirname(output_path)
    if out_dir:
        os.makedirs(out_dir, exist_ok=True)

    base_name = os.path.splitext(output_path)[0]
    
    ydl_opts = {
        'format': 'bestaudio/best',
        'outtmpl': base_name,
        'postprocessors': [{
            'key': 'FFmpegExtractAudio',
            'preferredcodec': 'wav',
            'preferredquality': '192',
        }],
        'quiet': True,
        'no_warnings': True,
    }

    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        ydl.download([url])

    expected_wav = base_name + '.wav'
    if os.path.exists(expected_wav) and expected_wav != output_path:
        os.rename(expected_wav, output_path)
        
    if not os.path.exists(output_path) and os.path.exists(base_name):
        os.rename(base_name, output_path)

if __name__ == '__main__':
    if len(sys.argv) < 3:
        print("Usage: python3 youtube.py search <query> OR python3 youtube.py download <videoId> <outPath>")
        sys.exit(1)
        
    mode = sys.argv[1]
    
    if mode == 'search':
        query = sys.argv[2]
        res = search_youtube(query)
        print(json.dumps({'success': True, 'results': res}))
    elif mode == 'download':
        vid = sys.argv[2]
        out_path = sys.argv[3]
        download_audio(vid, out_path)
        if os.path.exists(out_path):
            print(json.dumps({'success': True, 'file': out_path}))
        else:
            print(json.dumps({'success': False, 'error': 'File not generated'}))
