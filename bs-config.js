// bs-config.js
module.exports = {
  proxy: "http://localhost:3001",
  files: ["views/**/*.ejs", "public/**/*.*"], // reload otomatis jika file berubah
  port: 2000,
  ui: {
    port: 3005,
  },
  open: false,
  notify: false,
};
