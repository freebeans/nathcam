<script lang="ts">
  let { image }: { image: ImageData | null | undefined } = $props();
  let canvas: HTMLCanvasElement;

  $effect(() => {
    if (!image || !canvas) return;
    canvas.width = image.width;
    canvas.height = image.height;
    const ctx = canvas.getContext('2d', { colorSpace: image.colorSpace });
    ctx?.putImageData(image, 0, 0);
  });
</script>

<canvas bind:this={canvas} class:empty={!image}></canvas>

<style>
  canvas {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
    background: var(--track);
  }
  .empty {
    animation: pulse 1.2s ease-in-out infinite;
  }
  @keyframes pulse {
    50% {
      opacity: 0.5;
    }
  }
</style>
