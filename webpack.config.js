const path = require("path");
const HtmlWebpackPlugin = require("html-webpack-plugin");

module.exports = {
  entry: {
    poker: "./src/poker.ts",
    config: "./src/config.ts",
  },
  output: {
    filename: "[name].js",
    path: path.resolve(__dirname, "dist"),
  },
  resolve: {
    extensions: [".ts", ".js"],
  },
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        use: "ts-loader",
        exclude: /node_modules/,
      },
      {
        test: /\.css$/,
        use: ["style-loader", "css-loader"],
      },
    ],
  },
  plugins: [
    new HtmlWebpackPlugin({
      template: "./src/poker.html",
      filename: "poker.html",
      chunks: ["poker"],
      inject: "body",
    }),
    new HtmlWebpackPlugin({
      template: "./src/config.html",
      filename: "config.html",
      chunks: ["config"],
      inject: "body",
    }),
  ],
};
