const jwt = require("jsonwebtoken");
const otpGenerator = require("otp-generator");
const User = require("../models/user");

const signToken = (userId) =>
  jwt.sign(
    {
      userId,
    },
    process.env.JWT_SECRET,
  );

exports.login = async (req, res, next) => {
  const { email, password } = req.body;

  if (!email || !password) {
    res.status(400).json({
      status: "error",
      message: "Both email and password are required",
    });
  }

  const userDoc = await User.findOne({ email: email }).select("+password");

  if (!user || !(await user.correctPassword(password, userDoc.password))) {
    res.status(400).json({
      status: "error",
      message: "Email or Password is incorrect",
    });
  }

  const token = signToken(userDoc._id);

  //Register New User
  exports.register = async (req, res, next) => {
    const { firstName, lastName, email, password } = req.body;

    const filteredBody = filterObj(
      req.body,
      "firstName",
      "lastName",
      "password",
      "email",
    );

    // check if a verified user with given email exists

    const existing_user = await User.findOne({ email: email });

    if (existing_user && existing_user.verified) {
      res.status(400).json({
        status: "error",
        message: "Email is already in use, Please login",
      });
    } else if (existing_user) {
      await User.findOneAndUpdate({ email: email }, filteredBody, {
        new: true,
        validateModifiedOnly: true,
      });

      req.userId = existing_user._id;
      next();
    } else {
      // if user record is not available in DB
      const new_user = await User.create(filteredBody);

      //generate OTP and send email to user
      req.userId = new_user._id;

      next();
    }
  };

  exports.sendOTP = async () => {
    const { userId } = req;
    const new_otp = otpGenerator.generate(6, {
      upperCaseAlphabets: false,
      lowerCaseAlphabets: false,
      specialChars: false,
    });

    const otp_expiry_time = Date.now() + 10 * 60 * 100; // 10 minutes

    await User.findByIdAndUpdate(userId, {
      otp: new_otp,
      otp_expiry_time,
    });

    // TODO Send Mail

    res.status(200).json({
      status: "success",
      message: "OTP Sent Successfully",
    });
  };

  exports.verifyOTP = async (req, res, next) => {
    //verifyOTP and update user record accordingly

    const { email, otp } = req.body;

    const userDoc = await User.findOne({
      email,
      otp_expiry_time: { $gt: Date.now() },
    });

    if (!userDoc) {
      res.status(400).json({
        status: "error",
        message: "Email is Invalid or OTP expired",
      });
    }

    if (!(await userDoc.correctOTP(otp, userDoc.otp))) {
      res.status(400).json({
        status: "error",
        message: "OTP is incorrect",
      });
    }

    // OTP is correct
    userDoc.verified = true;
    userDoc.otp = undefined;

    await userDoc.save({
      new: true,
      validateModifiedOnly: true,
    });

    const token = signToken(userDoc._id);

    res.status(200).json({
      status: "success",
      message: "OTP verified successfully",
      token,
    });
  };
};
