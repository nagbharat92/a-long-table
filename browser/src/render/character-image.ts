import Phaser from 'phaser';

const CHARACTER_BATCH = 'CharacterBatch';

class CharacterBatch extends Phaser.Renderer.WebGL.RenderNodes.BatchHandlerQuad {
  constructor(manager: Phaser.Renderer.WebGL.RenderNodes.RenderNodeManager) {
    super(manager, { name: CHARACTER_BATCH, shaderName: 'CHARACTER_SINGLE_TEXTURE' });
  }

  override updateTextureCount(): void {
    // Phaser 4.2.1 compares interpolated texture IDs exactly; rotated quads can lose fragments.
    super.updateTextureCount(1);
  }
}

export function configureCharacterImage(image: Phaser.GameObjects.Image): Phaser.GameObjects.Image {
  const renderer = image.scene.game.renderer;
  if (!('renderNodes' in renderer)) throw new Error('Character images require the WebGL renderer.');
  const manager = renderer.renderNodes;
  let batch = manager.getNode(CHARACTER_BATCH);
  if (!batch) {
    batch = new CharacterBatch(manager);
    manager.addNode(CHARACTER_BATCH, batch);
  }
  return image.setRenderNodeRole('BatchHandler', batch);
}
