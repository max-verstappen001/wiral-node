import mongoose from "mongoose";
import dotenv from "dotenv";

dotenv.config();


const mongoConnect = async () => {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        console.log("Connected to MongoDB");
    } catch (error) {
        console.error("Error connecting to MongoDB:", error);
        process.exit(1);
    }
}
export default mongoConnect;