import gulp from "gulp"
//import rename from "gulp-rename"
import pkg from "gulp-uglify-es"
const uglify = pkg.default
console.log(uglify)
//import { init, write } from 'gulp-sourcemaps';
//import babel from "gulp-babel"
function defaultTask(cb) {
    // place code for your default task here
    cb();
    // src('lib/**/*.js')
    // .pipe(init())
    //   .pipe(plugin1())
    //   .pipe(plugin2())
    // .pipe(write())
    // .pipe(dest('dist'));

    gulp.src('example.js')
    // .pipe(babel({
    //     presets: ['@babel/env']
    // }))
    .pipe(uglify())
    //.pipe(rename('example.cjs'))

    .pipe(gulp.dest('dist'))

    gulp.src('index.js')
    // .pipe(babel({
    //     presets: ['@babel/env']
    // }))
    .pipe(uglify())
    .pipe(gulp.dest('dist'))

    gulp.src('lib/*.js')
    // .pipe(babel({
    //     presets: ['@babel/env']
    // }))
    .pipe(uglify())
    .pipe(gulp.dest('dist/lib'))
  }
  
  const _default = defaultTask;
export { _default as default };