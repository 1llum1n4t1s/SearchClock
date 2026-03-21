const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const sizes = [16, 48, 128];
const svgPath = path.join(__dirname, '../icons/icon.svg');
const imagesDir = path.join(__dirname, '../images');

async function generateIcons() {
  console.log('🎨 アイコン生成を開始します...\n');

  if (!fs.existsSync(svgPath)) {
    console.error('❌ エラー: icon.svg が見つかりません');
    process.exit(1);
  }

  fs.mkdirSync(imagesDir, { recursive: true });

  await Promise.all(sizes.map(async (size) => {
    const outputPath = path.join(imagesDir, `icon-${size}.png`);
    try {
      await sharp(svgPath)
        .resize(size, size)
        .png()
        .toFile(outputPath);

      console.log(`✅ ${size}x${size} アイコンを生成しました: ${path.basename(outputPath)}`);
    } catch (error) {
      console.error(`❌ ${size}x${size} アイコンの生成に失敗しました:`, error.message);
    }
  }));

  console.log('\n🎉 アイコン生成が完了しました！');
}

generateIcons().catch(error => {
  console.error('❌ エラーが発生しました:', error);
  process.exit(1);
});
