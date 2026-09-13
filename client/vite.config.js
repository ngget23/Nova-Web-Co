import { resolve } from "path";
import { defineConfig } from "vite";

// success.html and cancel.html are the Stripe return URLs, so they have to be
// emitted alongside index.html rather than left out of the build.
export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        success: resolve(__dirname, "success.html"),
        cancel: resolve(__dirname, "cancel.html")
      }
    }
  }
});
