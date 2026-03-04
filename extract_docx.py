import zipfile
import os
import sys
import xml.etree.ElementTree as ET

def extract_content(docx_path, out_dir):
    if not os.path.exists(out_dir):
        os.makedirs(out_dir)
    
    # Extract text
    with zipfile.ZipFile(docx_path, 'r') as docx:
        # Get text from document.xml
        xml_content = docx.read('word/document.xml')
        tree = ET.fromstring(xml_content)
        
        # Namespaces
        ns = {'w': 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}
        
        text_content = []
        for paragraph in tree.findall('.//w:p', ns):
            texts = paragraph.findall('.//w:t', ns)
            if texts:
                p_text = "".join([t.text for t in texts if t.text])
                text_content.append(p_text)
        
        with open(os.path.join(out_dir, 'extracted_text.txt'), 'w', encoding='utf-8') as f:
            f.write("\n".join(text_content))

        # Extract images (logo should be among them)
        image_dir = os.path.join(out_dir, 'images')
        if not os.path.exists(image_dir):
            os.makedirs(image_dir)
            
        for file in docx.namelist():
            if file.startswith('word/media/'):
                filename = os.path.basename(file)
                with open(os.path.join(image_dir, filename), 'wb') as f:
                    f.write(docx.read(file))
        
        print(f"Content extracted to {out_dir}")

if __name__ == "__main__":
    docx_file = "info/Invel_Holidays_Sri_Lanka_Itinerary.docx"
    output_directory = "extracted_info"
    extract_content(docx_file, output_directory)
